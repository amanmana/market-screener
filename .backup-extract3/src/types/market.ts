export interface Candle {
  ticker_full: string;
  price_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockMetadata {
  ticker_full: string;
  company_name: string;
  sector: string;
  market?: string;
}

export interface ScreenerResult {
  ticker_full: string;
  signal: string;
  price: number;
  date: string;
  metadata?: StockMetadata;
}
