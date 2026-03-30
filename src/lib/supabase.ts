import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Candle, StockMetadata } from '../types/market';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

/**
 * Initialize Supabase Client (Read-Only)
 */
export function getSupabase(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
    },
  });
}

/**
 * Fetch historical data for a symbol (Read-Only)
 */
export async function fetchStockPrices(
  supabase: SupabaseClient,
  ticker: string,
  limit: number = 100
): Promise<Candle[]> {
  const { data, error } = await supabase
    .from('klse_prices_daily')
    .select('ticker_full, price_date, open, high, low, close, volume')
    .eq('ticker_full', ticker)
    .order('price_date', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`Error fetching prices for ${ticker}:`, error.message);
    return [];
  }

  // Back to ascending for indicators
  return (data as Candle[]).reverse();
}

/**
 * Fetch all stock metadata (Read-Only)
 */
export async function fetchAllStocks(supabase: SupabaseClient): Promise<StockMetadata[]> {
  const { data, error } = await supabase
    .from('klse_stocks')
    .select('ticker_full, company_name, sector');

  if (error) {
    console.error('Error fetching stocks:', error.message);
    return [];
  }

  return data as StockMetadata[];
}

/**
 * Fetch latest EOD date (Read-Only)
 */
export async function fetchLatestDate(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from('klse_prices_daily')
    .select('price_date')
    .order('price_date', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.error('Error fetching latest date:', error.message);
    return null;
  }

  return data?.price_date || null;
}
