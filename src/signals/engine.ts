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
      const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      
      signal.entryRangeLow = Number((sma20 * 1.01).toFixed(3));
      signal.entryRangeHigh = signal.price;
      signal.isCaution = isWickRejection || isHighGap;

      if (signal.isCaution) {
        signal.reason = `⚠️ CAUTION: Selling Pressure detected. ` + (signal.reason || "");
      }

      if (signal.entryRangeLow > (signal.price || 0)) {
        signal.entryRangeLow = Number(((signal.price || 0) * 0.97).toFixed(3));
      }
    }
    return signal;
  }

  return { type: SignalType.NONE, price: current.close, timestamp: current.price_date };
}
