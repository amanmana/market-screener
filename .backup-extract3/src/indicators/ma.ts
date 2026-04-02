import { Candle } from "../types/market";

/**
 * Calculate Simple Moving Average (SMA)
 */
export function calculateSMA(candles: Candle[], period: number): number[] {
  const result: number[] = [];
  const prices = candles.map(c => c.close);
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(0);
      continue;
    }
    
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += prices[i - j];
    }
    result.push(sum / period);
  }
  
  return result;
}

/**
 * Check if a Moving Average is rising
 */
export function isRising(ma: number[], lookback: number = 2): boolean {
  if (ma.length < lookback) return false;
  const current = ma[ma.length - 1];
  const previous = ma[ma.length - lookback];
  return current > previous;
}
