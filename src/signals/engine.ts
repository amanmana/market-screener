import { Candle } from "../types/market";
import { SignalType, SignalResult } from "../types/signals";
import { checkSell } from "./strategies/sell";
import { checkWarn } from "./strategies/warn";
import { checkPreWarn } from "./strategies/preWarn";
import { checkBuyR } from "./strategies/buyR";
import { checkRebuy } from "./strategies/rebuy";
import { checkBuyT } from "./strategies/buyT";
import { checkSwing } from "./strategies/swingMaster";

// HELPERS FOR PROFESSIONAL BTST FORMULA
function calculateRSI(candles: Candle[], periods = 14): number {
  if (candles.length <= periods) return 50;
  let gains = 0, losses = 0;
  const slice = candles.slice(-periods - 1);
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i].close - slice[i-1].close;
    if (diff > 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function getBursaTick(price: number): number {
  if (price < 1) return 0.005; 
  if (price < 10) return 0.01; 
  if (price < 100) return 0.02;
  return 0.10;
}

function roundToTick(val: number, tick: number): number {
  return Math.round(val / tick) * tick;
}

function calculateSMA(values: number[], periods: number): number {
    if (values.length < periods) return values.reduce((a,b) => a+b, 0) / values.length;
    return values.slice(-periods).reduce((a,b) => a+b, 0) / periods;
}

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
    const currentPrice = signal.price || current.close;
    const closes = candles.map(c => c.close);
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume || 0);

    // SMAs
    const sma10 = calculateSMA(closes, 10);
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);
    
    // 1. ADD SESSION INFO
    signal.sessionHigh = current.high || current.close;
    signal.sessionLow = current.low || current.close;

    // 2. ENTRY RANGES
    if (signal.type === SignalType.BUY_T || signal.type === SignalType.REBUY) {
        signal.entryRangeLow  = Number(sma10.toFixed(3));
        signal.entryRangeHigh = Number((sma10 * 1.03).toFixed(3));
        if (currentPrice < signal.entryRangeLow) signal.entryRangeLow = Number(currentPrice.toFixed(3));
    } else if (signal.type === SignalType.BUY_R) {
        signal.entryRangeLow  = Number(sma20.toFixed(3));
        signal.entryRangeHigh = Number((sma20 * 1.03).toFixed(3));
        if (currentPrice < signal.entryRangeLow) signal.entryRangeLow = Number(currentPrice.toFixed(3));
    } else if (signal.type === SignalType.SWING) {
        const recent40High = Math.max(...highs.slice(-40));
        signal.entryRangeLow  = Number(sma50.toFixed(3));
        signal.entryRangeHigh = Number((sma50 * 1.04).toFixed(3));
        signal.btstTarget = Number((recent40High * 0.995).toFixed(3)); 
        signal.stopLoss = Number((sma50 * 0.995).toFixed(3)); 
    } else {
        signal.entryRangeLow  = Number(currentPrice.toFixed(3));
        signal.entryRangeHigh = Number((currentPrice * 1.03).toFixed(3));
    }

    // 3. BTST LOGIC (Based on Pine Script)
    const tick = getBursaTick(currentPrice);
    const maxEntry = roundToTick(current.high - tick, tick);
    const rsiVal = calculateRSI(candles, 14);

    // VOLUME SMAs (Strict Filtering)
    const volSma10 = calculateSMA(volumes, 10);
    const volSma30 = calculateSMA(volumes, 30);
    const volSma60 = calculateSMA(volumes, 60);
    const volSma90 = calculateSMA(volumes, 90);

    const isLiquid = volSma10 > 500000 && volSma30 > 300000 && volSma60 > 200000;
    const priceChange = (currentPrice / previous.close) >= 1.028; // Lowered to 2.8% (KLK is ~3.2%)

    if (
        (signal.type === SignalType.BUY_T || signal.type === SignalType.REBUY || signal.type === SignalType.SWING) &&
        isLiquid && 
        priceChange && 
        rsiVal < 70 &&
        currentPrice <= maxEntry &&
        currentPrice > 0.20
    ) {
        signal.isBTST = true;
        // Formula Reward Perc 2.5%
        const REWARD_MULT = 1.025;
        const RISK_MULT = 0.975;

        signal.btstTarget = Number(roundToTick(maxEntry * REWARD_MULT, tick).toFixed(3));
        
        // Stop loss: Calculation from Script is cl = entry - tick
        // We'll use approx 2.5% below entry
        const calculatedEntry = roundToTick(maxEntry * RISK_MULT, tick);
        signal.stopLoss = Number(roundToTick(calculatedEntry - tick, tick).toFixed(3));
        
        signal.reason = `🚀 BTST POTENTIAL [Professional Formula]. ` + (signal.reason || "");
    }

    // --- CAUTION CHECK ---
    const range = current.high - current.low;
    const bodyTop = Math.max(current.open, current.close);
    const topWick = current.high - bodyTop;
    const isWickRejection = range > 0 && (topWick / range) > 0.35;
    
    signal.isCaution = isWickRejection;
    if (signal.isCaution) {
        signal.reason = `⚠️ CAUTION: High Selling Pressure. ` + (signal.reason || "");
    }

    return signal;
  }

  return { type: SignalType.NONE, price: current.close, timestamp: current.price_date };
}
