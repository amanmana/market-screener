import { Candle } from "../types/market";
import { SignalType, SignalResult, EntryStatus } from "../types/signals";
import { checkBuyR } from "./strategies/buyR";
import { checkRebuy } from "./strategies/rebuy";
import { checkBuyT } from "./strategies/buyT";
import { checkSwing } from "./strategies/swingMaster";
import { checkSell } from "./strategies/sell";
import { checkWarn } from "./strategies/warn";
import { checkPreWarn } from "./strategies/preWarn";
import { calculateLiquidity } from "../utils/liquidity";
import { calculateHeikinAshi } from "../utils/indicators";
import { calculatePositionSize } from "../utils/trading";
import { computeTradeDecision } from "./decisionEngine";
import { evaluateMarketContext } from "./marketContext";

/**
 * NEW: Balanced Pyramid Ranking Model
 * Focus: High RR (2.0+) = A, Solid RR (1.6-2.0) = B, Borderline (1.2-1.6) = C
 */
function calculateSetupScore(res: SignalResult): { score: number, breakdown: any } {
    if (res.signal === SignalType.NONE) return { score: 0, breakdown: null };
    
    let score = 0;
    const rr = res.currentRR || 0;
    const status = res.entryStatus || '';
    const isLate = status === 'late_setup';
    const isRejected = ['reject_low_rr', 'reject_limited_upside', 'invalid', 'incomplete_trade_plan'].includes(status);

    // 1. RISK-REWARD ANCHOR (50 pts) - Linear distribution within bands
    let rrScore = 0;
    if (rr >= 3.0) rrScore = 50;      // Elite
    else if (rr >= 2.0) rrScore = 40 + (rr - 2.0) * 10; // 40-50 (A-Tier base)
    else if (rr >= 1.6) rrScore = 25 + (rr - 1.6) * 37.5; // 25-40 (B-Tier base)
    else if (rr >= 1.2) rrScore = 10 + (rr - 1.2) * 37.5; // 10-25 (C-Tier base)
    else if (rr >= 1.0) rrScore = 0;
    else rrScore = -70; // Severe penalty for RR < 1.0
    score += rrScore;

    // 2. ENTRY & QUALITY BOOST (35 pts)
    let entryScore = 0;
    const boostMap: Record<string, number> = {
        'premium_actionable': 35,
        'actionable': 25,
        'ideal': 30,
        'acceptable': 20,
        'watch_only': 5,
        'late_setup': -40,
        'waiting_confirmation': 0
    };
    entryScore = boostMap[status] || 0;
    score += entryScore;

    // 3. LIQUIDITY & SAFETY (15 pts)
    let liqScore = 0;
    if (res.liquidityPass) {
        liqScore = 10;
        if (res.exitRisk === 'LOW') liqScore += 5;
    } else {
        if (res.exitRisk === 'HIGH') liqScore = -60;
        else liqScore = -30;
    }
    score += liqScore;

    // 4. GLOBAL CRITICAL PENALTIES
    if (isRejected) score = -250;
    if (isLate && rr < 2.2) score -= 50; // Hard cap on late setups unless RR is exceptional

    const finalScore = Math.max(0, Math.min(100, score));
    const breakdown = { rr: rrScore, entry: entryScore, liquidity: liqScore };

    return { score: finalScore, breakdown };
}

/**
 * STRATEGIC TIER CLASSIFICATION
 * Rules-based mapping (not just score) to ensure balanced distribution.
 */
function getRankLabel(res: SignalResult, score: number): string {
    const rr = res.currentRR || 0;
    const status = res.entryStatus || '';
    const isLate = status === 'late_setup';
    const isRejected = ['reject_low_rr', 'reject_limited_upside', 'invalid', 'incomplete_trade_plan'].includes(status);

    if (isRejected || rr < 1.2) return 'D';
    
    // A-Tier: Premium Setup ONLY (RR 2.0+ and Not Late)
    if (rr >= 2.0 && !isLate && score >= 80) return 'A';

    // B-Tier: Solid Actionable (RR 1.6 - 2.0 OR exceptional Late setup)
    if (rr >= 1.6 && !isRejected && score >= 60) return 'B';

    // C-Tier: Watch/Borderline (RR 1.2 - 1.6)
    if (rr >= 1.2 && score >= 30) return 'C';

    return 'D';
}

export async function getLatestSignal(candles: Candle[], isLive: boolean = false, riskConfig?: any): Promise<SignalResult> {
  if (!candles || candles.length === 0) {
    return {
      signal: SignalType.NONE,
      entryStatus: 'insufficient_data',
      price: 0,
      rejectionReason: "insufficient_history"
    };
  }

  const current = candles[candles.length - 1];
  
  if (candles.length < 60) {
    return { 
      signal: SignalType.NONE, 
      entryStatus: 'insufficient_data',
      price: current.close,
      rejectionReason: "insufficient_history" 
    };
  }

  // 1. LIQUIDITY FILTER (Mandatory for Bursa)
  const liq = calculateLiquidity(candles);

  // 2. RUN STRATEGIES + QUALITY GATE
  const strategies = [
    { name: 'SELL', fn: checkSell },
    { name: 'WARN', fn: checkWarn },
    { name: 'REBUY', fn: checkRebuy },
    { name: 'BUY-T', fn: checkBuyT },
    { name: 'SWING', fn: checkSwing },
    { name: 'BUY-R', fn: checkBuyR }
  ];

  let activeResult: SignalResult | null = null;
  const rejections: string[] = [];

  for (const s of strategies) {
    let res = s.fn(candles) as SignalResult;
    if (!res || res.signal === SignalType.NONE) {
        if (res?.rejectionReason) rejections.push(`${s.name}: ${res.rejectionReason}`);
        continue;
    }

    // --- QUALITY GATE (Hard Filter for Actionability) ---
    const rr = res.currentRR || 0;
    
    if (rr < 1.0) {
        res.entryStatus = 'reject_low_rr';
        res.rejectionReason = 'RR too low for a valid entry (< 1.0)';
        res.explanation = 'Risk exceeds potential reward at current price.';
    } else if (res.entryStatus === 'late_setup' && rr < 1.5) {
        // Late + Mediocre RR = Watch only
        res.entryStatus = 'watch_only';
        res.rejectionReason = 'late_entry_poor_rr';
        res.explanation = 'Entry is late and reward is no longer attractive.';
    } else if (rr >= 2.0 && (res.entryStatus === 'ideal' || res.entryStatus === 'acceptable')) {
        res.entryStatus = 'premium_actionable';
    } else if (rr >= 1.5 && (res.entryStatus === 'ideal' || res.entryStatus === 'acceptable')) {
        res.entryStatus = 'actionable';
    } else if (rr < 1.5) {
        res.entryStatus = 'watch_only';
        res.explanation = res.explanation || 'RR is borderline; wait for better structure.';
    }

    // Prioritize the first valid signal found
    if (!activeResult) {
        activeResult = res;
    }
  }

  // Initialize output
  let output: SignalResult = activeResult || {
    signal: SignalType.NONE,
    price: current.close,
    rejectionReason: rejections.slice(0, 3).join(" | ")
  };

  // Add liquidity metadata
  Object.assign(output, liq);

  // ── MARKET CONTEXT FILTER ──
  if (output.signal !== SignalType.NONE && output.signal !== SignalType.SELL && output.signal !== SignalType.WARN && output.signal !== SignalType.PRE_WARN) {
      output.context = evaluateMarketContext(candles, output.signal as SignalType);
  }

  // Enhance with Balanced Pyramid Ranking & Sizing
  const { score, breakdown } = calculateSetupScore(output);
  output.setupScore = score;
  output.scoreBreakdown = breakdown;
  output.setupRank = getRankLabel(output, score);

  // Position Sizing (Only for actionable setups)
  if (['premium_actionable', 'actionable', 'ideal', 'acceptable'].includes(output.entryStatus || '')) {
    const sizingConfig = { ...riskConfig, targetPrice: output.targetPrice };
    output.sizing = calculatePositionSize(output.suggestedEntry || current.close, output.stopLoss || 0, sizingConfig);
  }

  // ── FINAL TRADE DECISION ENGINE ──────────────────────────────────────────
  const decision = computeTradeDecision(output);
  output.tradeDecision = decision.tradeDecision;
  output.decisionReason = decision.decisionReason;
  output.decisionConfidence = decision.decisionConfidence;
  // ─────────────────────────────────────────────────────────────────────────

  output.confirmed = !isLive;
  output.previewOnly = isLive;
  output.timestamp = current.price_date;

  // 3. HEIKIN ASHI CONFIRMATION
  const ha = calculateHeikinAshi(candles);
  if (ha.length >= 2) {
    const c1 = ha[ha.length - 1]; // Current
    const c2 = ha[ha.length - 2]; // Previous
    const c1Green = c1.close > c1.open;
    const c2Green = c2.close > c2.open;
    
    if (c1Green && c2Green) output.haStatus = '2_GREEN';
    else if (c1Green) output.haStatus = '1_GREEN';
    else output.haStatus = 'RED';
  } else {
    output.haStatus = 'INSUFFICIENT';
  }
  
  // Backward compatibility
  output.type = output.signal;
  output.reason = output.explanation || output.rejectionReason;
  output.rrRatio = output.currentRR; // Ensure UI never sees empty RR if data exists

  return output;
}
