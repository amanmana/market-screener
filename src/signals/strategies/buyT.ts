import { Candle } from "../../types/market";
import { SignalType, SignalResult } from "../../types/signals";
import { calculateSMA, isRising } from "../../indicators/ma";
import { calculateAverageVolume, getVolumeRatio } from "../../indicators/volume";

/**
 * BUY-T: Trend Continuation
 * Syarat:
 * - close > sma10 > sma20 (alignment trend)
 * - sma20 menaik dalam 3 hari lalu
 * - volume ratio >= 0.7
 * - close > close 3 hari lalu (momentum positif)
 */
export function checkBuyT(candles: Candle[]): SignalResult | null {
  if (candles.length < 22) return null;

  const current = candles[candles.length - 1];
  const prev3 = candles[candles.length - 4]; // 3 candle lalu

  const sma10Raw = calculateSMA(candles, 10);
  const sma20Raw = calculateSMA(candles, 20);

  const sma10 = sma10Raw[sma10Raw.length - 1];
  const sma20 = sma20Raw[sma20Raw.length - 1];

  const sma20Rising = isRising(sma20Raw, 3);
  const avgVol = calculateAverageVolume(candles, 20);
  const volRatio = getVolumeRatio(candles, avgVol);

  const isPriceAboveSMA10 = current.close > sma10;
  const isSMA10AboveSMA20 = sma10 > sma20;
  const isVolumeOk = volRatio >= 0.7;
  const isUptrend3Days = current.close > prev3.close; // Naik dari 3 hari lalu

  if (isPriceAboveSMA10 && isSMA10AboveSMA20 && sma20Rising && isVolumeOk && isUptrend3Days) {
    return {
      type: SignalType.BUY_T,
      reason: `Trend menaik. SMA10(${sma10.toFixed(3)}) > SMA20(${sma20.toFixed(3)}), harga naik ${((current.close/prev3.close-1)*100).toFixed(1)}% dalam 3 hari, volume ${volRatio.toFixed(2)}x.`,
      price: current.close,
      timestamp: current.price_date
    };
  }

  return null;
}
