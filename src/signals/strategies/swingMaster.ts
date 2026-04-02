import { Candle } from "../../types/market";
import { SignalType, SignalResult } from "../../types/signals";
import { calculateSMA, detectStructuralPivots, findMeaningfulResistance } from "../../utils/indicators";
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

  // 2. LEVELS - Structural Swing Targets (SMA50 bounce)
  const { target } = findMeaningfulResistance(currentPrice, highs, lows, 'SWING');
  const tick = getBursaTick(currentPrice);
  
  // 3. TARGET VALIDATION (Hard Rule 5)
  if (!target) {
     return {
         ...base,
         entryStatus: 'incomplete_trade_plan',
         rejectionReason: 'no_meaningful_resistance_above',
         explanation: 'No clear structural resistance found above the SMA50 support bounce.'
     };
  }
  
  // Choose stop loss: previous structural low OR SMA50
  const { support: sPivots } = detectStructuralPivots(highs, lows, 5);
  const structuralLow = sPivots.length > 0 ? sPivots[sPivots.length - 1].price : sma50;
  const stopLoss = roundToTick(Math.min(structuralLow, sma50) * 0.985, tick); 

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
    entryStatus: entry.entryStatus,
    targetPrice: target,
    stopLoss: stopLoss,
    currentRR: entry.currentRR,
    rrRatio: entry.currentRR, // For backward compatibility
    supportLevel: sma50,
    resistanceLevel: target,
    confidence: 80,
    explanation: entry.entryStatus === 'late_setup'
        ? `SMA50 bounce, but resistance at RM ${target.toFixed(3)} is too close.`
        : `Institutional bounce from rising SMA50 toward RM ${target.toFixed(3)}.`,
    confirmed: true
  };
}
