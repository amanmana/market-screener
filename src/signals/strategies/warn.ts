import { Candle } from "../../types/market";
import { SignalType, SignalResult } from "../../types/signals";
import { calculateSMA } from "../../indicators/ma";

/**
 * WARN: Amaran - harga jatuh bawah SMA20 dengan momentum lemah
 */
export function checkWarn(candles: Candle[]): SignalResult | null {
  if (candles.length < 20) return null;

  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];

  const sma20Raw = calculateSMA(candles, 20);
  const sma20 = sma20Raw[sma20Raw.length - 1];
  const sma10Raw = calculateSMA(candles, 10);
  const sma10 = sma10Raw[sma10Raw.length - 1];

  const isPriceBelowSMA20 = current.close < sma20;
  const isPriceBelowSMA10 = current.close < sma10;
  const isMomentumWeak = current.close < previous.close;
  const isBearishCandle = current.close < current.open;

  // Warn: harga bawah kedua-dua SMA + candle bearish
  if (isPriceBelowSMA20 && isPriceBelowSMA10 && isMomentumWeak && isBearishCandle) {
    const reason = `Momentum lemah. Harga (${current.close}) di bawah SMA10(${sma10.toFixed(3)}) & SMA20(${sma20.toFixed(3)}).`;
    return {
      type: SignalType.WARN,
      reason,
      price: current.close,
      timestamp: current.price_date
    };
  }

  return null;
}
