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

      // ROUTE: Full Stock List (For Search) - DIRECT FROM SUPABASE
      if (url.pathname === '/api/market/list') {
        const { data: stocks, error: supErr } = await supabase
          .from('klse_stocks')
          .select('ticker_full, company_name, short_name, shariah_status, market')
          .in('market', ['MYR', 'BURSA'])
          .order('company_name', { ascending: true });

        if (supErr) {
          return new Response(JSON.stringify({ error: supErr.message }), { status: 500, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ results: stocks || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ROUTE: Mirror Supabase -> D1 (Comprehensive Sync)
      if (url.pathname === '/api/market/sync-star') {
        // 1. Fetch ALL from Supabase (Limit removed to ensure all counters like TENAGA are included)
        const { data: stocks, error: supErr } = await supabase
          .from('klse_stocks')
          .select('ticker_full, company_name, short_name, shariah_status, market')
          .in('market', ['MYR', 'BURSA']);

        if (supErr || !stocks) throw new Error(`Supabase query error: ${supErr?.message}`);

        // 2. Prepare D1 Statements
        const statements: D1PreparedStatement[] = [];
        for (const s of stocks) {
          statements.push(
            env.DB.prepare(`INSERT OR REPLACE INTO bursa_counters (ticker_full, company_name, short_name, shariah_status, market, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
                  .bind(s.ticker_full, s.company_name, s.short_name, s.shariah_status, s.market)
          );
        }

        // 3. Batch Execute in D1
        const BATCH_SIZE = 50;
        for (let i = 0; i < statements.length; i += BATCH_SIZE) {
          await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
        }

        return new Response(JSON.stringify({ success: true, count: stocks.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

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

        // 2. Fetch History from Supabase AND Sync to D1
        const tickers = stocks.map(s => s.ticker_full);
        const dataCache = new Map<string, any[]>();
        
        // Fetch 120 candles per stock from Supabase
        const { data: allHistory, error: historyErr } = await supabase
          .from('klse_prices_daily')
          .select('ticker_full, open, high, low, close, volume, price_date')
          .in('ticker_full', tickers)
          .order('price_date', { ascending: false });

        if (historyErr) throw new Error(`History fetch error: ${historyErr.message}`);

        // Group by ticker and prepare for D1 sync
        const syncRows: any[] = [];
        allHistory?.forEach((r: any) => {
          if (!dataCache.has(r.ticker_full)) dataCache.set(r.ticker_full, []);
          if (dataCache.get(r.ticker_full)!.length < 120) {
            dataCache.get(r.ticker_full)!.push(r);
            syncRows.push(r);
          }
        });

        // Background Sync to D1 (Mirroring)
        if (syncRows.length > 0) {
          const stmt = env.DB.prepare(`INSERT OR REPLACE INTO prices_mirror (ticker, price_date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)`);
          ctx.waitUntil(env.DB.batch(syncRows.map(r => stmt.bind(r.ticker_full, r.price_date, r.open, r.high, r.low, r.close, r.volume))));
        }

        // 3. (NEW) Fetch Risk Settings for Batch Sizing
        const { results: riskRows } = await env.DB.prepare(`SELECT * FROM risk_settings WHERE id = 1`).all();
        const risk = riskRows?.[0] || { account_size: 20000, risk_per_trade_percent: 1.5, max_capital_per_stock_percent: 20 };
        const riskConfig = {
          accountSize: Number(risk.account_size),
          riskPctPerTrade: Number(risk.risk_per_trade_percent),
          maxPositionPct: Number(risk.max_capital_per_stock_percent)
        };

        // 4. Process Batch
        const finalResults: any[] = [];
        for (const stock of stocks) {
          const history = dataCache.get(stock.ticker_full) || [];
          const sig = await getLatestSignal([...history].reverse(), false, riskConfig);
          
          finalResults.push({
            ticker: stock.ticker_full,
            name: stock.company_name,
            timestamp: history.length > 0 ? history[0].price_date : null,
            ...sig,
            signal: sig.signal,
            reason: sig.explanation || sig.rejectionReason,
            targetPrice: sig.targetPrice,
            stopLoss: sig.stopLoss,
            avgVolumeRM: sig.avgTradedValue20
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

        // 1. Primary Source: Supabase (Fastest for 1100+ counters)
        let { data: supaCandles, error: supaErr } = await supabase
          .from('klse_prices_daily')
          .select('open, high, low, close, volume, price_date')
          .eq('ticker_full', ticker)
          .order('price_date', { ascending: false })
          .limit(100);

        let candles: any[] = supaCandles || [];

        // 2. Fallback Source: Yahoo Finance History (High fidelity for missing data)
        if (candles.length < 60) {
          try {
            console.log(`Insufficient history for ${ticker} in Supabase (${candles.length}). Falling back to Yahoo.`);
            const yfHistory = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=6mo`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
            });
            const yfData: any = await yfHistory.json();
            const result = yfData?.chart?.result?.[0];
            if (result && result.timestamp) {
              const quotes = result.indicators.quote[0];
              const timestamps = result.timestamp;
              const formattedYf = timestamps.map((ts: number, i: number) => ({
                open: quotes.open[i] || quotes.close[i],
                high: quotes.high[i] || quotes.close[i],
                low: quotes.low[i] || quotes.close[i],
                close: quotes.close[i],
                volume: quotes.volume[i] || 0,
                price_date: new Date(ts * 1000).toISOString().split('T')[0]
              })).filter((c: any) => c.close != null).reverse();
              
              if (formattedYf.length >= 60) {
                candles = formattedYf;
                // Optional: Cache back to D1 for extremely fast future access
                const stmt = env.DB.prepare(`INSERT OR REPLACE INTO prices_mirror (ticker, price_date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)`);
                ctx.waitUntil(env.DB.batch(candles.slice(0, 100).map(c => stmt.bind(ticker, c.price_date, c.open, c.high, c.low, c.close, c.volume))));
              }
            }
          } catch (e) {
            console.error('Yahoo History Fallback Error:', e);
          }
        }

        if (candles.length < 60) {
          throw new Error(`Insufficient history for ${ticker} (Supabase: ${supaCandles?.length || 0}, Yahoo: failed)`);
        }

        // 3. Live Price (1-min precision for Intra-day signals)
        let live = { close: candles[0].close, high: candles[0].high, low: candles[0].low };
        try {
          const yfLive = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } 
          });
          const yd: any = await yfLive.json();
          const meta = yd?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) {
            live.close = meta.regularMarketPrice;
            if (meta.regularMarketDayHigh) live.high = Math.max(meta.regularMarketDayHigh, live.close);
            if (meta.regularMarketDayLow) live.low = Math.min(meta.regularMarketDayLow, live.close);
          }
        } catch (e) {
            console.warn('Yahoo Live Price Error:', e);
        }

        // 3. Merge Live Data (Virtual Candle)
        const virtual = { 
            ticker_full: ticker,
            open: Number(candles[0].open),
            high: Number(live.high),
            low: Number(live.low),
            close: Number(live.close),
            volume: Number(candles[0].volume),
            price_date: new Date().toISOString() 
        };
        
        // 4. Analysis with Dynamic Risk Profile
        const { results: riskRows } = await env.DB.prepare(`SELECT * FROM risk_settings WHERE id = 1`).all();
        const risk = riskRows?.[0] || { account_size: 20000, risk_per_trade_percent: 1.5, max_capital_per_stock_percent: 20 };
        const riskConfig = {
          accountSize: Number(risk.account_size),
          riskPctPerTrade: Number(risk.risk_per_trade_percent),
          maxPositionPct: Number(risk.max_capital_per_stock_percent)
        };

        const engineHistory = candles.map(c => ({ ...c, ticker_full: ticker }));
        const sig = await getLatestSignal([virtual, ...engineHistory.slice(1)].reverse(), true, riskConfig);

        // 5. Calculate Change
        const prevClose = candles[0].close;
        const change = live.close - prevClose;
        const changePercent = (change / prevClose) * 100;

        // 6. Get Company Name
        const { data: stockInfo } = await supabase
          .from('klse_stocks')
          .select('company_name')
          .eq('ticker_full', ticker)
          .single();

        return new Response(JSON.stringify({ 
            ticker, 
            name: stockInfo?.company_name || ticker,
            price: live.close, 
            change,
            changePercent,
            ...sig, 
            avgVolumeRM: sig.avgTradedValue20, // Map the correct field
            signal: sig.signal || sig.type, 
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
            signal, reason, status,
            trade_decision, decision_confidence, decision_reason,
            entry_range_low, entry_range_high, rr_ratio, entry_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          p.ticker, 
          p.name || '', 
          p.suggestedEntry || p.suggested_entry || p.price || p.entry_price || 0, 
          p.targetPrice || p.target_price || 0, 
          p.stopLoss || p.stop_loss || 0, 
          p.signal || 'HOLD', 
          p.explanation || p.reason || '',
          p.tradeDecision || p.trade_decision || null,
          p.decisionConfidence || p.decision_confidence || null,
          p.decisionReason || p.decision_reason || null,
          p.entryRangeLow || p.entry_range_low || 0,
          p.entryRangeHigh || p.entry_range_high || 0,
          p.currentRR || p.rrRatio || p.rr_ratio || 0,
          p.entryStatus || p.entry_status || null
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
        return new Response(JSON.stringify({ 
           results: (results || []).map((r: any) => ({ 
             ...r, 
             isBTST: r.is_btst === 1,
             tradeDecision: r.trade_decision || r.tradeDecision,
             decisionConfidence: r.decision_confidence || r.decisionConfidence,
             decisionReason: r.decision_reason || r.decisionReason,
             entryRangeLow: r.entry_range_low || r.entryRangeLow,
             entryRangeHigh: r.entry_range_high || r.entryRangeHigh,
             rrRatio: r.rr_ratio || r.rrRatio,
             entryStatus: r.entry_status || r.entryStatus
           })) 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ROUTE: Risk Settings Management (Multi-device Sync)
      if (url.pathname === '/api/risk/settings') {
        const { results } = await env.DB.prepare(`SELECT * FROM risk_settings WHERE id = 1`).all();
        return new Response(JSON.stringify(results?.[0] || {}), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/api/risk/update' && request.method === 'POST') {
        const p: any = await request.json();
        await env.DB.prepare(
          `UPDATE risk_settings SET 
            account_size = ?, 
            risk_per_trade_percent = ?, 
            max_capital_per_stock_percent = ?,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = 1`
        ).bind(p.account_size, p.risk_per_trade_percent, p.max_capital_per_stock_percent).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  },
};
