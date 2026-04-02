import { getSupabase } from './lib/supabase';
import { getLatestSignal } from './signals/engine';
import { SignalType, SignalResult } from './types/signals';

export default {
  async fetch(request: Request, env: { DB: D1Database; SUPABASE_URL: string; SUPABASE_ANON_KEY: string }, ctx: ExecutionContext): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
      if (!env.DB) throw new Error('Database D1 NOT Found! Check wrangler.toml');
      const url = new URL(request.url);
      const supabase = getSupabase(env);

      // ROUTE: Bulk Screener (Bursa Only)
      if (url.pathname === '/api/screener/latest') {
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const batchLimit = parseInt(url.searchParams.get('limit') || '200');

        // 1. Get Stocks (Locked to MYR)
        const { data: stocks, count: totalStocks, error: stockErr } = await supabase
          .from('klse_stocks')
          .select('ticker_full, company_name, market', { count: 'exact' })
          .eq('market', 'MYR')
          .range(offset, offset + batchLimit - 1);

        if (stockErr || !stocks) throw new Error(`Stock query error: ${stockErr?.message}`);

        // 2. Fetch History from D1 Mirror
        const tickers = stocks.map(s => s.ticker_full);
        const d1Cache = new Map<string, any[]>();
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
            if (d1Cache.get(r.ticker)!.length < 120) d1Cache.get(r.ticker)!.push(r);
          });
        }

        // 3. Process Batch
        const finalResults: any[] = [];
        for (const stock of stocks) {
          const history = d1Cache.get(stock.ticker_full) || [];
          const sig = await getLatestSignal([...history].reverse(), false);
          
          // 1. STRICT EXCLUSION: No low liquidity or thin counters for default screener
          if (!sig.liquidityPass || sig.exitRisk === 'HIGH') continue;
          
          // 2. TRUTHFUL FILTERING: 
          // Show if: has a signal OR is a recognized trade-planning state (late/waiting/incomplete)
          const isShowable = 
            sig.signal !== SignalType.NONE || 
            ['late_setup', 'waiting_confirmation', 'incomplete_trade_plan'].includes(sig.entryStatus || '');

          if (!isShowable) continue;

          finalResults.push({
            ticker: stock.ticker_full,
            name: stock.company_name,
            ...sig,
            signal: sig.signal,
            reason: sig.explanation || sig.rejectionReason,
            targetPrice: sig.targetPrice,
            stopLoss: sig.stopLoss,
            avgVolumeRM: sig.avgTradedValue20 // Map the correct field
          });
        }

        // 4. Default Result Ordering: Rank A -> D, then Score Desc
        finalResults.sort((a, b) => {
            const rankMap: Record<string, number> = { 'A': 1, 'B': 2, 'C': 3, 'D': 4 };
            const rA = rankMap[a.setupRank || 'D'];
            const rB = rankMap[b.setupRank || 'D'];
            if (rA !== rB) return rA - rB;
            return (b.setupScore || 0) - (a.setupScore || 0);
        });

        return new Response(JSON.stringify({ results: finalResults, total: totalStocks || 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ROUTE: Individual Refresh (LIVE PREVIEW)
      if (url.pathname.startsWith('/api/market/quote/')) {
        const ticker = url.pathname.split('/').pop();
        if (!ticker) throw new Error('Ticker missing');

        const { results: d1Rows } = await env.DB.prepare(
          `SELECT open, high, low, close, volume, price_date FROM prices_mirror 
           WHERE ticker = ? ORDER BY price_date DESC LIMIT 120`
        ).bind(ticker).all();

        let candles: any[] = d1Rows || [];

        // Critical fallback
        if (candles.length < 60) {
          const { data } = await supabase.from('klse_prices_daily').select('*').eq('ticker_full', ticker).order('price_date', { ascending: false }).limit(120);
          candles = data || [];
          if (candles.length > 0) {
            const stmt = env.DB.prepare(`INSERT OR REPLACE INTO prices_mirror (ticker, price_date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            ctx.waitUntil(env.DB.batch(candles.map(c => stmt.bind(ticker, c.price_date, c.open, c.high, c.low, c.close, c.volume))));
          }
        }

        if (candles.length < 60) throw new Error(`Insufficient history for ${ticker}`);

        // Live Price Fetch
        let live = { close: candles[0].close, high: candles[0].high, low: candles[0].low };
        try {
          const yf = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          const yd: any = await yf.json();
          const meta = yd?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            live.close = meta.regularMarketPrice;
            live.high = Math.max(meta.regularMarketDayHigh || live.close, live.close);
            live.low = Math.min(meta.regularMarketDayLow || live.close, live.close);
          }
        } catch (_) {}

        const virtual = { ...candles[0], ...live, price_date: new Date().toISOString() };
        const sig = await getLatestSignal([virtual, ...candles.slice(1)].reverse(), true);

        return new Response(JSON.stringify({ 
            ticker, 
            price: live.close, 
            ...sig, 
            avgVolumeRM: sig.avgTradedValue20, // Map the correct field
            signal: sig.type, 
            reason: sig.explanation || sig.reason 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ROUTE: Portfolio Management
      if (url.pathname === '/api/portfolio/add' && request.method === 'POST') {
        const p: any = await request.json();
        // Use ticker as unique key to prevent multiple entries (Triple GENP bug fix)
        await env.DB.prepare(
          `INSERT OR REPLACE INTO swing_portfolio (
            ticker, name, entry_price, target_price, stop_loss, 
            signal, reason, is_btst, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`
        ).bind(
          p.ticker, 
          p.name || '', 
          p.suggestedEntry || p.price || p.entry_price || 0, 
          p.targetPrice || p.target_price || 0, 
          p.stopLoss || p.stop_loss || 0, 
          p.signal || 'HOLD', 
          p.explanation || p.reason || '', 
          p.isBTST ? 1 : 0
        ).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/portfolio/remove' && request.method === 'POST') {
        const { ticker } = (await request.json()) as any;
        await env.DB.prepare(`DELETE FROM swing_portfolio WHERE ticker = ?`).bind(ticker).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/portfolio/list') {
        const { results } = await env.DB.prepare(`SELECT * FROM swing_portfolio ORDER BY entry_date DESC`).all();
        return new Response(JSON.stringify({ results: (results || []).map((r: any) => ({ ...r, isBTST: r.is_btst === 1 })) }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  },
};
