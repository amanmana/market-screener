import { Candle } from "../../types/market";
import { SignalType, SignalResult } from "../../types/signals";
import { calculateSMA, isRising } from "../../indicators/ma";
import { calculateStochastic } from "../../indicators/stochastic";
import { calculateAverageVolume, getVolumeRatio } from "../../indicators/volume";

/**
 * BUY-R: Early Reversal
 * - Stochastic K naik dari oversold (< 30)
 * - Candle bullish
 * - Price reclaim SMA10 ATAU close > prev close
 */
export function checkBuyR(candles: Candle[]): SignalResult | null {
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

  const avgVol = calculateAverageVolume(candles, 20);
  const volRatio = getVolumeRatio(candles, avgVol);

  const wasOversold = prevK < 35 || prevD < 35;
  const isKRising = k > prevK;
  const isKCrossAboveD = prevK <= prevD && k > d;
  const isBullishCandle = current.close > current.open;
  const isCloseHigher = current.close > previous.close;
  const isVolumeOk = volRatio >= 0.7;

  if (wasOversold && (isKRising || isKCrossAboveD) && isBullishCandle && isCloseHigher && isVolumeOk) {
    return {
      type: SignalType.BUY_R,
      reason: `Pembalikan awal. Stochastic K(${k.toFixed(1)}) naik dari kawasan oversold, candel bullish dengan volume ${volRatio.toFixed(2)}x.`,
      price: current.close,
      timestamp: current.price_date
    };
  }

  return null;
}
