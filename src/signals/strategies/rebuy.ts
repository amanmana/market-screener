import { Candle } from "../../types/market";
import { SignalType, SignalResult } from "../../types/signals";
import { calculateSMA, detectStructuralPivots, calculateStochastic, findMeaningfulResistance } from "../../utils/indicators";
import { calculateRR, getBursaTick, roundToTick, analyzeEntry, getExtensionPercent } from "../../utils/trading";

export function checkRebuy(candles: Candle[]): SignalResult {
  const current = candles[candles.length - 1];
  const base: SignalResult = {
    signal: SignalType.NONE,
    setupFamily: 'REBUY',
    price: current.close,
    explanation: '',
    rejectionReason: 'no_active_setup'
  };

  if (candles.length < 40) {
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
  
  const sma20Raw = calculateSMA(closes, 20);
  const sma50Raw = calculateSMA(closes, 50);
  const sma20 = sma20Raw[sma20Raw.length - 1]!;
  const sma50 = sma50Raw[sma50Raw.length - 1]!;
  
  const { k } = calculateStochastic(highs, lows, closes);
  const curK = k[k.length - 1] || 0;

  // 1. HARD CRITERIA
  const isHealthyTrend = sma20 > sma50;
  if (!isHealthyTrend) {
      base.rejectionReason = 'trend_not_confirmed';
      return base;
  }

  const extension = getExtensionPercent(currentPrice, sma20);
  const isPullbackValid = extension >= -1 && extension <= 3; // Near SMA20
  if (!isPullbackValid) {
      base.rejectionReason = 'not_near_support';
      return base;
  }

  if (curK > 80) {
      base.rejectionReason = 'stochastic_overheated';
      return base;
  }

  // 2. LEVELS - Structural Rebuy Targets
  const { target } = findMeaningfulResistance(currentPrice, highs, lows, 'CONTINUATION');
  const tick = getBursaTick(currentPrice);
  
  // 3. TARGET VALIDATION (Hard Rule 5)
  if (!target) {
     return {
         ...base,
         entryStatus: 'incomplete_trade_plan',
         rejectionReason: 'no_meaningful_resistance_above',
         explanation: 'No clear prior swing highs found for pullback continuation.'
     };
  }

  // Pivot support or SMA20
  const { support: sPivots } = detectStructuralPivots(highs, lows, 5);
  const structuralLow = sPivots.length > 0 ? sPivots[sPivots.length - 1].price : sma20;
  const stopLoss = roundToTick(Math.min(structuralLow, sma20) * 0.985, tick);

  // REBUY thresholds: ideal=1.8 (short term), min=1.3
  const entry = analyzeEntry(currentPrice, target, stopLoss, 1.8, 1.3);
  
  if (entry.entryStatus === 'invalid') {
      return {
        ...base,
        ...entry,
        rejectionReason: 'setup_broken_at_sl',
        explanation: 'Price dropped below the SMA20 support level.'
      };
  }

  return {
    ...base,
    signal: SignalType.REBUY,
    ...entry,
    entryStatus: entry.entryStatus,
    targetPrice: target,
    stopLoss: stopLoss,
    currentRR: entry.currentRR,
    rrRatio: entry.currentRR, 
    supportLevel: sma20,
    resistanceLevel: target,
    confidence: 75,
    explanation: entry.entryStatus === 'late_setup'
        ? `Pullback recovery, but resistance at RM ${target.toFixed(3)} is too close.`
        : `Pullback recovery toward swing high at RM ${target.toFixed(3)}.`,
    confirmed: true
  };
}
