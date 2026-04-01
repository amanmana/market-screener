import { getSupabase } from './lib/supabase';
import { getLatestSignal } from './signals/engine';
import { SignalType } from './types/signals';

export default {
  async fetch(request: Request, env: { DB: D1Database; SUPABASE_URL: string; SUPABASE_ANON_KEY: string }, ctx: ExecutionContext): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
      if (!env.DB) throw new Error('Database D1 Tidak Dijumpai! Perlu check wrangler.toml');
      const url = new URL(request.url);

      // Health check
      if (url.pathname === '/api/health') {
        return new Response(JSON.stringify({ status: 'OK', message: 'Backend is ALIVE!' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const supabase = getSupabase(env);

      // ROUTE: Bulk Screener
      if (url.pathname === '/api/screener/latest') {
        const market = url.searchParams.get('market') || 'MYR';
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const limit = parseInt(url.searchParams.get('limit') || '200');

        // Get total count
        let countQ = supabase.from('klse_stocks').select('*', { count: 'exact', head: true });
        if (market === 'US') countQ = countQ.ilike('market', 'US%');
        else countQ = countQ.eq('market', market);
        const { count: totalC } = await countQ;

        // Get stocks for this batch
        let stockQ = supabase.from('klse_stocks').select('ticker_full, company_name, market');
        if (market === 'US') stockQ = stockQ.ilike('market', 'US%');
        else stockQ = stockQ.eq('market', market);
        const { data: stocks, error: stockErr } = await stockQ.range(offset, offset + limit - 1);

        if (stockErr) throw new Error(`Stock query error: ${stockErr.message}`);
        if (!stocks || stocks.length === 0) {
          return new Response(JSON.stringify({ results: [], total: totalC || 0 }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Get prices for all tickers in one batch
        const tickers = stocks.map(s => s.ticker_full);
        const { data: allPrices, error: priceErr } = await supabase
          .from('klse_prices_daily')
          .select('ticker_full, price_date, open, high, low, close, volume')
          .in('ticker_full', tickers)
          .order('price_date', { ascending: false })
          .limit(tickers.length * 40);

        if (priceErr) throw new Error(`Price query error: ${priceErr.message}`);

        // Build price map
        const priceMap = new Map<string, any[]>();
        allPrices?.forEach(p => {
          if (!priceMap.has(p.ticker_full)) priceMap.set(p.ticker_full, []);
          priceMap.get(p.ticker_full)!.push(p);
        });

        // --- BULK D1 CACHE FETCH (CHUNKED TO PREVENT SQL PARAM LIMITS) ---
        const d1Cache = new Map<string, any[]>();
        
        // Chunk tickers to batches of 90 to avoid D1 limit (max 100 vars)
        const CHUNK_SIZE = 90;
        for (let i = 0; i < tickers.length; i += CHUNK_SIZE) {
          const chunk = tickers.slice(i, i + CHUNK_SIZE);
          const { results: d1Rows } = await env.DB.prepare(
            `SELECT ticker, open, high, low, close, volume, price_date FROM prices_mirror 
             WHERE ticker IN (${chunk.map(() => '?').join(',')}) 
             ORDER BY price_date DESC`
          ).bind(...chunk).all();
          
          d1Rows?.forEach((r: any) => {
            if (!d1Cache.has(r.ticker)) d1Cache.set(r.ticker, []);
            if (d1Cache.get(r.ticker)!.length < 60) d1Cache.get(r.ticker)!.push(r);
          });
        }

        // Run signal engine
        const results = [];
        const syncBatch: any[] = [];

        for (const stock of stocks) {
          let candles = d1Cache.get(stock.ticker_full) || [];
          
          if (candles.length < 40) {
            candles = priceMap.get(stock.ticker_full) || [];
            
            if (candles.length > 0) {
              const stmt = env.DB.prepare(
                `INSERT OR REPLACE INTO prices_mirror (ticker, price_date, open, high, low, close, volume) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
              );
              candles.forEach(c => {
                syncBatch.push(stmt.bind(
                  stock.ticker_full, 
                  c.price_date, 
                  Number(c.open || 0), 
                  Number(c.high || 0), 
                  Number(c.low || 0), 
                  Number(c.close || 0), 
                  Number(c.volume || 0)
                ));
              });
            }
          }

          if (candles.length >= 20) {
            const sig = await getLatestSignal([...candles].reverse());
            if (sig.type !== SignalType.NONE) {
              results.push({
                ticker: stock.ticker_full,
                name: stock.company_name,
                signal: sig.type,
                reason: sig.reason,
                price: sig.price,
                isCaution: sig.isCaution,
                isBTST: sig.isBTST,
                btstTarget: sig.btstTarget,
                stopLoss: sig.stopLoss,
                entryRangeLow: sig.entryRangeLow,
                entryRangeHigh: sig.entryRangeHigh,
              });
            }
          }
        }

        // Background Batch Sync (Safety limit 100 statements per batch)
        if (syncBatch.length > 0) {
          const chunks = [];
          for (let i = 0; i < syncBatch.length; i += 100) {
            chunks.push(env.DB.batch(syncBatch.slice(i, i + 100)));
          }
          ctx.waitUntil(Promise.all(chunks));
        }

        return new Response(JSON.stringify({ results, total: totalC || 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ROUTE: Individual Quote (Quick Refresh)
      if (url.pathname.startsWith('/api/market/quote/')) {
        const ticker = url.pathname.split('/').pop();
        if (!ticker) throw new Error('Ticker missing');

        // Try D1 Cache first
        const { results: d1Rows } = await env.DB.prepare(
          `SELECT open, high, low, close, volume, price_date FROM prices_mirror 
           WHERE ticker = ? ORDER BY price_date DESC LIMIT 60`
        ).bind(ticker).all();

        let candles: any[] = d1Rows || [];

        if (candles.length < 40) {
          const { data: history, error: hErr } = await supabase
            .from('klse_prices_daily')
            .select('*')
            .eq('ticker_full', ticker)
            .order('price_date', { ascending: false })
            .limit(40);

          if (hErr) throw new Error(hErr.message);
          candles = history || [];
          
        // Sync in background
        if (candles.length > 0) {
          try {
            const stmt = env.DB.prepare(`INSERT OR REPLACE INTO prices_mirror (ticker, price_date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            ctx.waitUntil(env.DB.batch(candles.map(c => stmt.bind(ticker, c.price_date, Number(c.open), Number(c.high), Number(c.low), Number(c.close), Number(c.volume)))));
          } catch (e) {
            console.error('D1 Sync Error:', e);
          }
        }
        }

        if (candles.length === 0) throw new Error(`No history for ${ticker}`);

        let livePrice = candles[0].close;
        try {
          const yf = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`,
            { headers: { 'User-Agent': 'Mozilla/5.0' } }
          );
          if (yf.ok) {
            const yd: any = await yf.json();
            const meta = yd?.chart?.result?.[0]?.meta;
            if (meta?.regularMarketPrice) livePrice = meta.regularMarketPrice;
          }
        } catch (_) {}

        const virtual = { ...candles[0], close: livePrice, price_date: new Date().toISOString() };
        const sig = await getLatestSignal([virtual, ...candles.slice(1)].reverse());

        return new Response(JSON.stringify({ 
          ticker, 
          price: livePrice, 
          signal: sig.type,
          isCaution: sig.isCaution, 
          reason: sig.reason,
          entryRangeLow: sig.entryRangeLow,
          entryRangeHigh: sig.entryRangeHigh,
          isBTST: sig.isBTST,
          btstTarget: sig.btstTarget,
          stopLoss: sig.stopLoss
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ROUTE: Add to Portfolio
      if (url.pathname === '/api/portfolio/add' && request.method === 'POST') {
        const payload: any = await request.json();
        
        // Prevent generic duplicate tickers 
        const existing = await env.DB.prepare(`SELECT id FROM swing_portfolio WHERE ticker = ?`).bind(payload.ticker).first();
        if (existing) {
          // Update the existing row
          await env.DB.prepare(
             `UPDATE swing_portfolio SET entry_price=?, target_price=?, stop_loss=?, status='OPEN' WHERE ticker=?`
          ).bind(
            payload.entry_price ?? null, 
            payload.target_price ?? null, 
            payload.stop_loss ?? null, 
            payload.ticker
          ).run();
        } else {
          // Insert a new row
          await env.DB.prepare(
            `INSERT INTO swing_portfolio (ticker, name, entry_price, target_price, stop_loss, status) 
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(
            payload.ticker, 
            payload.name ?? '', 
            payload.entry_price ?? null, 
            payload.target_price ?? null, 
            payload.stop_loss ?? null, 
            'OPEN'
          ).run();
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ROUTE: Remove from Portfolio
      if (url.pathname === '/api/portfolio/remove' && request.method === 'POST') {
        const payload: any = await request.json();
        
        await env.DB.prepare(`DELETE FROM swing_portfolio WHERE ticker = ?`).bind(payload.ticker).run();
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ROUTE: List Portfolio
      if (url.pathname === '/api/portfolio/list') {
        const { results } = await env.DB.prepare(
          `SELECT * FROM swing_portfolio ORDER BY entry_date DESC`
        ).all();

        return new Response(JSON.stringify({ results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (err: any) {
      console.error('SERVER_ERROR:', err);
      return new Response(JSON.stringify({ 
        error: err.message,
        stack: err.stack,
        hint: 'Sila pastikan D1 database anda di-binding dengan nama DB'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
};
