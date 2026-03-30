import { Candle } from "../../types/market";
import { SignalType, SignalResult } from "../../types/signals";
import { calculateSMA } from "../../indicators/ma";
import { calculateStochastic } from "../../indicators/stochastic";

/**
 * PRE-WARN: Single early alert
 * - selepas bullish regime
 * - stochastic mula cross down dari kawasan tinggi
 * ATAU
 * - close jatuh bawah sma10 selepas run-up
 */
export function checkPreWarn(candles: Candle[]): SignalResult | null {
  if (candles.length < 20) return null;

  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  
  const sma10Raw = calculateSMA(candles, 10);
  const sma10 = sma10Raw[sma10Raw.length - 1];
  
  const stoch = calculateStochastic(candles, 14, 3, 3);
  const k = stoch.k[stoch.k.length - 1];
  const d = stoch.d[stoch.d.length - 1];
  const prevK = stoch.k[stoch.k.length - 2];
  const prevD = stoch.d[stoch.d.length - 2];

  const isOverboughtZone = prevK > 70 || prevD > 70;
  const isKCrossDownD = prevK >= prevD && k < d;
  const isPriceBelowSMA10 = current.close < sma10 && previous.close >= sma10Raw[sma10Raw.length - 2];

  if ((isOverboughtZone && isKCrossDownD) || isPriceBelowSMA10) {
    return {
      type: SignalType.PRE_WARN,
      reason: isPriceBelowSMA10 ? "Price dropped below SMA10." : "Stochastic cross-down from overbought zone.",
      price: current.close,
      timestamp: current.price_date
    };
  }

  return null;
}
