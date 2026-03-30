import { getSupabase } from './lib/supabase';
import { getLatestSignal } from './signals/engine';
import { SignalType } from './types/signals';

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // Health check
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'OK', message: 'Backend is ALIVE!' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
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
          .select('ticker_full, price_date, open, high, low, close')
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

        // Run signal engine
        const results = [];
        for (const stock of stocks) {
          const candles = priceMap.get(stock.ticker_full) || [];
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
                entryRangeLow: sig.entryRangeLow,
                entryRangeHigh: sig.entryRangeHigh,
              });
            }
          }
        }

        return new Response(JSON.stringify({ results, total: totalC || 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // ROUTE: Individual Quote (Quick Refresh)
      if (url.pathname.startsWith('/api/market/quote/')) {
        const ticker = url.pathname.split('/').pop();
        if (!ticker) throw new Error('Ticker missing');

        const { data: history, error: hErr } = await supabase
          .from('klse_prices_daily')
          .select('*')
          .eq('ticker_full', ticker)
          .order('price_date', { ascending: false })
          .limit(35);

        if (hErr) throw new Error(hErr.message);
        if (!history || history.length === 0) throw new Error(`No history for ${ticker}`);

        let livePrice = history[0].close;
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

        const virtual = { ...history[0], close: livePrice, price_date: new Date().toISOString() };
        const sig = await getLatestSignal([virtual, ...history.slice(1)].reverse());

        return new Response(JSON.stringify({ ticker, price: livePrice, isCaution: sig.isCaution, reason: sig.reason }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
};
