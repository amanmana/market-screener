import { Candle } from "../../types/market";
import { SignalType, SignalResult } from "../../types/signals";
import { calculateSMA, calculateStochastic, detectPivotLevels, findNearestResistance } from "../../utils/indicators";
import { calculateRR, getBursaTick, roundToTick, analyzeEntry } from "../../utils/trading";

export function checkBuyR(candles: Candle[]): SignalResult {
  const current = candles[candles.length - 1];
  const base: SignalResult = {
    signal: SignalType.NONE,
    setupFamily: 'BUY-R',
    price: current.close,
    explanation: '',
    rejectionReason: 'no_active_setup'
  };

  if (candles.length < 20) {
    return { 
      signal: SignalType.NONE, 
      entryStatus: 'insufficient_data',
      price: current.close,
      rejectionReason: 'insufficient_history'
    };
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const currentPrice = current.close;

  const stoch = calculateStochastic(highs, lows, closes);
  const k = stoch.k[stoch.k.length - 1] || 0;
  const d = stoch.d[stoch.d.length - 1] || 0;
  const prevK = stoch.k[stoch.k.length - 2] || 0;

  // 1. HARD CRITERIA
  const wasOversold = prevK < 35;
  const isRisingK = k > prevK;
  
  if (!wasOversold) {
      base.rejectionReason = 'no_oversold_structure';
      return base;
  }

  if (!isRisingK) {
      return {
          ...base,
          entryStatus: 'waiting_confirmation',
          rejectionReason: 'waiting_for_k_recovery',
          explanation: 'Price is in oversold zone. Waiting for Stochastic K to cross up.'
      };
  }

  // 2. LEVELS
  const { resistance, support, allResistance, allSupport } = detectPivotLevels(closes, highs, lows, 5);
  const target = findNearestResistance(currentPrice, allResistance, resistance);
  const tick = getBursaTick(currentPrice);
  
  // Pivot low or recent minor low
  const structuralLow = allSupport.length > 0 ? allSupport[allSupport.length - 1] : support;
  const stopLoss = roundToTick(Math.min(structuralLow, support) * 0.985, tick); 

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

  // BUY-R thresholds: ideal=1.8 (as updated), min=1.3
  const entry = analyzeEntry(currentPrice, target, stopLoss, 1.8, 1.3);
  
  if (entry.entryStatus === 'invalid') {
      return {
        ...base,
        ...entry,
        rejectionReason: 'setup_broken_at_sl',
        explanation: 'The reversal structure has broken major support.'
      };
  }

  return {
    ...base,
    signal: SignalType.BUY_R,
    ...entry,
    stopLoss,
    targetPrice: target,
    rrRatio: calculateRR(entry.suggestedEntry || currentPrice, target, stopLoss),
    supportLevel: support,
    resistanceLevel: target,
    confidence: 65,
    explanation: `Early reversal. Stochastic recovery from oversold zone.`,
    confirmed: true
  };
}
