import { Candle } from "../types/market";
import { SignalType, SignalResult } from "../types/signals";
import { checkSell } from "./strategies/sell";
import { checkWarn } from "./strategies/warn";
import { checkPreWarn } from "./strategies/preWarn";
import { checkBuyR } from "./strategies/buyR";
import { checkRebuy } from "./strategies/rebuy";
import { checkBuyT } from "./strategies/buyT";
import { checkSwing } from "./strategies/swingMaster";

export async function getLatestSignal(candles: Candle[]): Promise<SignalResult> {
  if (candles.length === 0) {
    return { type: SignalType.NONE, timestamp: new Date().toISOString() };
  }

  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2] || current;
  let signal: SignalResult | null = null;

  if (signal = checkSell(candles)) {}
  else if (signal = checkWarn(candles)) {}
  else if (signal = checkPreWarn(candles)) {}
  else if (signal = checkBuyR(candles)) {}
  else if (signal = checkRebuy(candles)) {}
  else if (signal = checkBuyT(candles)) {}
  else if (signal = checkSwing(candles)) {}

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

    const isBuySignal = [SignalType.BUY_T, SignalType.BUY_R, SignalType.REBUY, SignalType.SWING].includes(signal.type);
    
    if (isBuySignal) {
      const closes = candles.map(c => c.close);
      const highs  = candles.map(c => c.high);
      const lows   = candles.map(c => c.low);
      
      const sma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
      const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const sma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : sma20;
      const recent5Low  = Math.min(...lows.slice(-5));
      const recent10Low = Math.min(...lows.slice(-10));
      const currentPrice = signal.price || current.close;

      if (signal.type === SignalType.BUY_T || signal.type === SignalType.REBUY) {
        // BUY-T / REBUY: Reclaimed SMA10 support
        // Zone: SMA10 (Support) -> SMA10 * 1.03 (Max safe entry)
        signal.entryRangeLow  = Number(sma10.toFixed(3));
        signal.entryRangeHigh = Number((sma10 * 1.03).toFixed(3));
        // If current price is below SMA10 (wicking up), range starts from price
        if (currentPrice < signal.entryRangeLow) signal.entryRangeLow = Number(currentPrice.toFixed(3));

      } else if (signal.type === SignalType.BUY_R) {
        // BUY-R: Reversal bounce — masuk di kawasan support SMA20
        // Zone: SMA20 (Support) -> SMA20 * 1.03
        signal.entryRangeLow  = Number(sma20.toFixed(3));
        signal.entryRangeHigh = Number((sma20 * 1.03).toFixed(3));
        // If current price is below SMA20 (pumping from below), range starts from price
        if (currentPrice < signal.entryRangeLow) signal.entryRangeLow = Number(currentPrice.toFixed(3));

      } else if (signal.type === SignalType.SWING) {
        // SWING: SMA50 entry zone (mid-term focus)
        signal.entryRangeLow  = Number(sma50.toFixed(3));
        signal.entryRangeHigh = Number((sma50 * 1.04).toFixed(3));
        signal.btstTarget = Number((currentPrice * 1.10).toFixed(3)); // TP +10% target for swing
        signal.stopLoss = Number((currentPrice * 0.965).toFixed(3)); // 3.5% SL

      } else {
        // Fallback for any other buy signals
        signal.entryRangeLow  = Number(currentPrice.toFixed(3));
        signal.entryRangeHigh = Number((currentPrice * 1.03).toFixed(3));
      }

      // --- BTST POTENTIAL DETECTION ---
      const volumes = candles.map(c => c.volume || 0);
      const avgVol = (volumes.slice(-6, -1).reduce((a, b) => a + b, 0) || 1) / 5;
      const currentVol = current.volume || 0;
      const prevClose = previous.close || 1;
      const priceChangePct = ((currentPrice - prevClose) / prevClose) * 100;
      const candleBody = Math.abs(current.close - current.open);
      const upperWick = current.high - Math.max(current.close, current.open);

      // Criteria: Bullish, Volume Spike > 1.5x, Price Up > 2.5%, Wick small
      if (
        (signal.type === SignalType.BUY_T || signal.type === SignalType.REBUY) &&
        currentVol > avgVol * 1.5 && 
        priceChangePct > 2.5 &&
        upperWick < candleBody * 0.3
      ) {
        signal.isBTST = true;
        signal.btstTarget = Number((currentPrice * 1.025).toFixed(3)); // TP +2.5%
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
