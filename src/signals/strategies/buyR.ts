import { Candle } from "../../types/market";
import { SignalType, SignalResult } from "../../types/signals";
import { calculateSMA, calculateStochastic, detectStructuralPivots, findMeaningfulResistance } from "../../utils/indicators";
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

  // 2. LEVELS - Structural Reversal Targets
  const { target } = findMeaningfulResistance(currentPrice, highs, lows, 'REVERSAL');
  const tick = getBursaTick(currentPrice);
  
  // 3. TARGET VALIDATION (Hard Rule 5)
  if (!target) {
     return {
         ...base,
         entryStatus: 'incomplete_trade_plan',
         rejectionReason: 'no_meaningful_resistance_above',
         explanation: 'No clear structural resistance found for reversal target.'
     };
  }

  // Pivot low for SL
  const { support: sPivots } = detectStructuralPivots(highs, lows, 5);
  const structuralLow = sPivots.length > 0 ? sPivots[sPivots.length - 1].price : currentPrice * 0.95;
  const stopLoss = roundToTick(structuralLow * 0.985, tick);

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
    entryStatus: entry.entryStatus,
    targetPrice: target,
    stopLoss: stopLoss,
    currentRR: entry.currentRR,
    rrRatio: entry.currentRR, 
    supportLevel: structuralLow,
    resistanceLevel: target,
    confidence: 65,
    explanation: entry.entryStatus === 'late_setup'
        ? `Early reversal, but resistance at RM ${target.toFixed(3)} is too close.`
        : `Reversal setup toward structural resistance at RM ${target.toFixed(3)}.`,
    confirmed: true
  };
}
