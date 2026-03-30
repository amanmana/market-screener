import { Candle } from "../../types/market";
import { SignalType, SignalResult } from "../../types/signals";
import { calculateSMA, isRising } from "../../indicators/ma";

/**
 * REBUY: Trend pullback
 * Context:
 * - trend masih valid
 * - ada pullback ke sma20 / support
 * Trigger:
 * - close kembali kukuh
 * - bullish candle
 * - reclaim sma10 atau break previous high
 */
export function checkRebuy(candles: Candle[]): SignalResult | null {
  if (candles.length < 30) return null;

  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  
  const sma10Raw = calculateSMA(candles, 10);
  const sma20Raw = calculateSMA(candles, 20);
  
  const sma10 = sma10Raw[sma10Raw.length - 1];
  const sma20 = sma20Raw[sma20Raw.length - 1];
  const sma20Rising = isRising(sma20Raw, 5);

  const isTrendValid = sma10 > sma20 && sma20Rising;
  const isPreviousPullback = previous.low <= sma20 * 1.02; // Close or touched SMA20
  const isBullishCandle = current.close > current.open;
  const isPriceReclaimedSMA10 = current.close > sma10 && previous.close <= sma10Raw[sma10Raw.length - 2];
  const isBreakingPreviousHigh = current.close > previous.high;

  if (isTrendValid && isPreviousPullback && isBullishCandle && (isPriceReclaimedSMA10 || isBreakingPreviousHigh)) {
    return {
      type: SignalType.REBUY,
      reason: "Trend pullback holding SMA20 with bounce and reclaim of SMA10.",
      price: current.close,
      timestamp: current.price_date
    };
  }

  return null;
}
