import { Candle } from "../types/market";

/**
 * Calculate Average True Range (ATR)
 */
export function calculateATR(candles: Candle[], period: number = 14): number[] {
  const tr: number[] = [];
  const atr: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    const current = candles[i];
    if (i === 0) {
      tr.push(current.high - current.low);
    } else {
      const previous = candles[i - 1];
      const h_l = current.high - current.low;
      const h_pc = Math.abs(current.high - previous.close);
      const l_pc = Math.abs(current.low - previous.close);
      tr.push(Math.max(h_l, h_pc, l_pc));
    }
    
    if (i < period - 1) {
      atr.push(0);
      continue;
    }
    
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += tr[j];
      }
      atr.push(sum / period);
    } else {
      const prevAtr = atr[i - 1];
      atr.push((prevAtr * (period - 1) + tr[i]) / period);
    }
  }
  
  return atr;
}
