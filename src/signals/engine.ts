import { Candle } from "../types/market";
import { SignalType, SignalResult } from "../types/signals";
import { checkSell } from "./strategies/sell";
import { checkWarn } from "./strategies/warn";
import { checkPreWarn } from "./strategies/preWarn";
import { checkBuyR } from "./strategies/buyR";
import { checkRebuy } from "./strategies/rebuy";
import { checkBuyT } from "./strategies/buyT";

export async function getLatestSignal(candles: Candle[]): Promise<SignalResult> {
  if (candles.length === 0) {
    return { type: SignalType.NONE, timestamp: new Date().toISOString() };
  }

  const current = candles[candles.length - 1];
  let signal: SignalResult | null = null;

  if (signal = checkSell(candles)) {}
  else if (signal = checkWarn(candles)) {}
  else if (signal = checkPreWarn(candles)) {}
  else if (signal = checkBuyR(candles)) {}
  else if (signal = checkRebuy(candles)) {}
  else if (signal = checkBuyT(candles)) {}

  if (signal) {
    // 1. ADD SESSION INFO
    signal.sessionHigh = current.high;
    signal.sessionLow = current.low;

    const range = current.high - current.low;
    const bodyTop = Math.max(current.open, current.close);
    const topWick = current.high - bodyTop;
    const gapFromHighPrc = ((current.high - current.close) / current.high) * 100;
    
    // 30% wick rejection OR 0.5% gap from high
    const isWickRejection = range > 0 && (topWick / range) > 0.30;
    const isHighGap = gapFromHighPrc > 0.5;

    const isBuySignal = [SignalType.BUY_T, SignalType.BUY_R, SignalType.REBUY].includes(signal.type);
    
    if (isBuySignal) {
      const closes = candles.map(c => c.close);
      const highs  = candles.map(c => c.high);
      const lows   = candles.map(c => c.low);
      
      const sma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
      const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const recent5Low  = Math.min(...lows.slice(-5));
      const recent10Low = Math.min(...lows.slice(-10));
      const currentPrice = signal.price || current.close;

      if (signal.type === SignalType.BUY_T) {
        // BUY-T: Trend naik — masuk berhampiran SMA10 support
        // Zone: SMA10 → SMA10 × 1.03 (boleh masuk sekarang atau tunggu minor pullback)
        signal.entryRangeLow  = Number(sma10.toFixed(3));
        signal.entryRangeHigh = Number((sma10 * 1.03).toFixed(3));
        if (signal.entryRangeHigh > currentPrice * 1.01) signal.entryRangeHigh = Number(currentPrice.toFixed(3));

      } else if (signal.type === SignalType.BUY_R) {
        // BUY-R: Pembalikan — masuk di kawasan oversold antara recent low dan SMA20
        signal.entryRangeLow  = Number(recent5Low.toFixed(3));
        signal.entryRangeHigh = Number(Math.min(sma20, currentPrice).toFixed(3));
        if (signal.entryRangeLow >= signal.entryRangeHigh) {
          signal.entryRangeLow = Number((signal.entryRangeHigh * 0.97).toFixed(3));
        }

      } else {
        // REBUY: Tambah posisi — masuk semasa pullback ke SMA20
        // Zone: recent 10-day low → SMA10 (kawasan terbaik untuk tambah)
        signal.entryRangeLow  = Number(Math.max(recent10Low, sma20 * 0.98).toFixed(3));
        signal.entryRangeHigh = Number(sma10.toFixed(3));
        if (signal.entryRangeLow >= signal.entryRangeHigh) {
          signal.entryRangeLow = Number((signal.entryRangeHigh * 0.97).toFixed(3));
        }
      }

      signal.isCaution = isWickRejection || isHighGap;
      if (signal.isCaution) {
        signal.reason = `⚠️ CAUTION: Selling Pressure detected. ` + (signal.reason || "");
      }
    }
    return signal;
  }

  return { type: SignalType.NONE, price: current.close, timestamp: current.price_date };
}
