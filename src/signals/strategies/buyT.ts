import { Candle } from "../../types/market";
import { SignalType, SignalResult } from "../../types/signals";
import { calculateSMA, detectStructuralPivots, calculateStochastic, findMeaningfulResistance } from "../../utils/indicators";
import { calculateRR, getBursaTick, roundToTick, analyzeEntry, getExtensionPercent } from "../../utils/trading";

export function checkBuyT(candles: Candle[]): SignalResult {
  const current = candles[candles.length - 1];
  const base: SignalResult = {
    signal: SignalType.NONE,
    setupFamily: 'BUY-T',
    price: current.close,
    explanation: '',
    rejectionReason: 'no_active_setup'
  };

  if (candles.length < 30) {
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
  
  const sma10Raw = calculateSMA(closes, 10);
  const sma20Raw = calculateSMA(closes, 20);
  const sma10 = sma10Raw[sma10Raw.length - 1]!;
  const sma20 = sma20Raw[sma20Raw.length - 1]!;
  
  const { k } = calculateStochastic(highs, lows, closes);
  const curK = k[k.length - 1] || 0;

  // 1. HARD CRITERIA
  const isTrendAligned = currentPrice > sma10 && sma10 > sma20;
  if (!isTrendAligned) {
      base.rejectionReason = 'trend_not_confirmed';
      return base;
  }

  const extension = getExtensionPercent(currentPrice, sma10);
  if (extension > 4.5) {
      base.rejectionReason = 'price_too_extended';
      return base;
  }

  if (curK > 85) {
      base.rejectionReason = 'stochastic_overheated';
      return base;
  }

  // 2. LEVELS - Structural Detection
  const { target, secondary } = findMeaningfulResistance(currentPrice, highs, lows, 'CONTINUATION');
  const tick = getBursaTick(currentPrice);

  // 3. TARGET VALIDATION (Hard Rule 5)
  if (!target) {
     return {
         ...base,
         entryStatus: 'incomplete_trade_plan',
         rejectionReason: 'no_meaningful_resistance_above',
         explanation: 'No clear structural resistance found above the current price level.'
     };
  }

  // Use SMA10 or nearest support as Stop Loss
  const { support: sPivots } = detectStructuralPivots(highs, lows, 5);
  const structuralLow = sPivots.length > 0 ? sPivots[sPivots.length - 1].price : sma10;
  const stopLoss = roundToTick(Math.min(structuralLow, sma10) * 0.985, tick);

  // BUY-T thresholds: ideal=1.8 (short term), min=1.3
  const entry = analyzeEntry(currentPrice, target, stopLoss, 1.8, 1.3);
  
  if (entry.entryStatus === 'invalid') {
      return {
        ...base,
        ...entry,
        rejectionReason: 'setup_broken_at_sl',
        explanation: 'Price dropped below the SMA10 trend support.'
      };
  }

  return {
    ...base,
    signal: SignalType.BUY_T,
    ...entry,
    entryStatus: entry.entryStatus,
    targetPrice: target,
    stopLoss: stopLoss,
    currentRR: entry.currentRR,
    rrRatio: entry.currentRR, 
    supportLevel: sma10,
    resistanceLevel: target,
    confidence: 70,
    explanation: entry.entryStatus === 'late_setup' 
        ? `Resistance at RM ${target.toFixed(3)} is too close; upside limited.`
        : `Strong trend continuation above SMA10 toward RM ${target.toFixed(3)}.`,
    confirmed: true
  };
}
