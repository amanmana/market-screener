import { Candle } from "../../types/market";
import { SignalType, SignalResult } from "../../types/signals";
import { calculateSMA } from "../../indicators/ma";

/**
 * SELL: Exit confirm
 * - close < sma20 dan structure rosak
 * - sma10 cross under sma20
 * - close < trailing stop (not implemented here, but implied by SMA20 break)
 */
export function checkSell(candles: Candle[]): SignalResult | null {
  if (candles.length < 30) {
    return {
      signal: SignalType.NONE,
      setupFamily: 'EXIT',
      rejectionReason: 'insufficient_data',
      explanation: 'Need 30+ candles for SMA verification'
    };
  }

  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  
  const sma10Raw = calculateSMA(candles, 10);
  const sma20Raw = calculateSMA(candles, 20);
  
  const sma10 = sma10Raw[sma10Raw.length - 1];
  const sma20 = sma20Raw[sma20Raw.length - 1];
  const prevSma10 = sma10Raw[sma10Raw.length - 2];
  const prevSma20 = sma20Raw[sma20Raw.length - 2];

  const isCrossUnder = prevSma10 >= prevSma20 && sma10 < sma20;
  const isBreakingSMA20 = current.close < sma20;
  const isBreakingPreviousLow = current.close < previous.low;

  if (isCrossUnder || (isBreakingSMA20 && isBreakingPreviousLow)) {
    return {
      signal: SignalType.SELL,
      setupFamily: 'EXIT',
      explanation: isCrossUnder ? "SMA10 cross-under SMA20 (Death Cross)." : "Confirmed bearish break below SMA20.",
      price: current.close,
      timestamp: current.price_date
    };
  }

  return {
    signal: SignalType.NONE,
    setupFamily: 'EXIT',
    rejectionReason: 'trend_held',
    explanation: 'Price still above major support (SMA20)'
  };
}
