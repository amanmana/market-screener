import { Candle } from "../../types/market";
import { SignalType, SignalResult } from "../../types/signals";

/**
 * STRATEGY: Swing Master (7-20 Days)
 * Focus: Institutional Support (SMA50) Bounce
 * Goal: 8-10% profit by riding the mid-term trend.
 */
export function checkSwing(candles: Candle[]): SignalResult | null {
  if (candles.length < 50) return null;

  const current = candles[candles.length - 1];
  const closes = candles.map(c => c.close);
  
  // 1. Calculate SMA 50 & 10
  const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const sma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  
  const currentPrice = current.close;

  // 2. CRITERIA:
  // - Price is above SMA 50 (Healthy trend)
  // - Price is near SMA 50 (Low risk entry, < 4% from SMA50)
  // - Short term momentum is picking up (Price > SMA10)
  const isAboveSMA50 = currentPrice > sma50;
  const isNearSMA50 = currentPrice <= (sma50 * 1.04);
  const isBullishRecovery = currentPrice > sma10;

  if (isAboveSMA50 && isNearSMA50 && isBullishRecovery) {
    return {
      type: SignalType.SWING,
      price: currentPrice,
      reason: `🚀 SWING: Bouncing from SMA50 support. Strong mid-term trend.`,
      timestamp: current.price_date
    };
  }

  return null;
}
