import { Candle } from "../../types/market";
import { SignalType, SignalResult } from "../../types/signals";
import { calculateSMA, detectPivotLevels, findNearestResistance } from "../../utils/indicators";
import { calculateRR, getBursaTick, roundToTick, analyzeEntry } from "../../utils/trading";

export function checkSwing(candles: Candle[]): SignalResult {
  const current = candles[candles.length - 1];
  const base: SignalResult = {
    signal: SignalType.NONE,
    setupFamily: 'SWING',
    price: current.close,
    explanation: '',
    rejectionReason: 'no_active_setup'
  };

  if (candles.length < 60) {
    return { 
      signal: SignalType.NONE, 
      entryStatus: 'insufficient_data',
      price: current.close,
      rejectionReason: "insufficient_history" 
    };
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const previous = candles[candles.length - 2];
  
  const sma50List = calculateSMA(closes, 50);
  const sma50 = sma50List[sma50List.length - 1]!;
  const prevSma50 = sma50List[sma50List.length - 2]!;
  const currentPrice = current.close;

  // 1. HARD CRITERIA
  if (sma50 <= prevSma50) {
      base.rejectionReason = 'sma50_not_rising';
      return base;
  }
  if (currentPrice <= sma50) {
      base.rejectionReason = 'not_near_support'; // actually below support
      return base;
  }
  
  const isNearSma50 = currentPrice <= (sma50 * 1.05); // within 5%
  if (!isNearSma50) {
      base.rejectionReason = 'price_too_extended';
      return base;
  }

  const { resistance, allResistance, allSupport } = detectPivotLevels(closes, highs, lows, 5);
  const target = findNearestResistance(currentPrice, allResistance, resistance);
  const tick = getBursaTick(currentPrice);
  
  // Choose stop loss: either previous 5-day structural low OR SMA50 (whichever is closer/better)
  const structuralLow = allSupport.length > 0 ? allSupport[allSupport.length - 1] : sma50;
  const stopLoss = roundToTick(Math.min(structuralLow, sma50) * 0.985, tick); 

  // VALIDATION: Target must be above current price by at least 1% to be actionable
  if (target <= currentPrice * 1.01) {
      return {
        ...base,
        targetPrice: target,
        stopLoss,
        entryStatus: 'late_setup', 
        rejectionReason: 'price_at_resistance'
      };
  }

  // RR thresholds: ideal=1.8 (short term), min=1.3
  const entry = analyzeEntry(currentPrice, target, stopLoss, 1.8, 1.3);
  
  if (entry.entryStatus === 'invalid') {
      return {
        ...base,
        ...entry,
        rejectionReason: 'setup_broken_at_sl',
        explanation: 'Price dropped below the SMA50 structure.'
      };
  }
  
  return {
    ...base,
    signal: SignalType.SWING,
    ...entry,
    stopLoss,
    targetPrice: target,
    rrRatio: calculateRR(entry.suggestedEntry || currentPrice, target, stopLoss),
    supportLevel: sma50,
    resistanceLevel: target,
    confidence: 80,
    explanation: `Institutional bounce from rising SMA50. Support at ${sma50.toFixed(3)}.`,
    confirmed: true
  };
}
