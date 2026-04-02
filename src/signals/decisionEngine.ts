import { SignalResult } from '../types/signals';

export type TradeDecision = 'ENTER' | 'WAIT' | 'AVOID';
export type DecisionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface DecisionOutput {
  tradeDecision: TradeDecision;
  decisionReason: string;
  decisionConfidence: DecisionConfidence;
}

// Statuses that indicate a rejected/invalid trade plan
const REJECT_STATUSES = new Set([
  'reject_low_rr',
  'reject_limited_upside',
  'invalid',
  'incomplete_trade_plan',
  'insufficient_data',
  'no_active_setup',
]);

// Statuses that mean "setup exists, entry not attractive yet"
const WATCH_STATUSES = new Set([
  'watch_only',
  'waiting_confirmation',
  'late_setup',
]);

// Statuses that are genuinely actionable
const ACTION_STATUSES = new Set([
  'premium_actionable',
  'actionable',
  'ideal',
  'acceptable',
]);

/**
 * Final Trade Decision Engine
 *
 * Called AFTER:
 *   1. Strategy detection
 *   2. Quality gate (entryStatus, RR filtering)
 *   3. Ranking (setupRank, setupScore)
 *   4. Sizing (sizing metadata)
 *
 * Decision hierarchy (stricter rules always win):
 *   AVOID > WAIT > ENTER
 */
export function computeTradeDecision(signal: SignalResult): DecisionOutput {
  const rr = signal.currentRR || 0;
  const status = signal.entryStatus || 'no_active_setup';
  const rank = signal.setupRank || 'D';
  const score = signal.setupScore || 0;
  const liquidityPass = signal.liquidityPass === true;
  const exitRisk = signal.exitRisk || 'HIGH';
  const ctx = signal.context;

  // ─── TIER 1: HARD AVOID (Immediate disqualifiers) ──────────────────────────

  // 1a. No signal at all
  if (!signal.signal || signal.signal === 'NONE' || status === 'no_active_setup') {
    return avoid('No active setup detected', 'HIGH');
  }

  // 1b. Rejected by quality gate
  if (REJECT_STATUSES.has(status)) {
    const reasonMap: Record<string, string> = {
      'reject_low_rr':          'RR too low — risk exceeds potential reward',
      'reject_limited_upside':  'Upside too limited — target too close to entry',
      'invalid':                'Invalid trade plan — check TP/SL levels',
      'incomplete_trade_plan':  'Incomplete trade plan — missing TP or SL',
      'insufficient_data':      'Not enough price history to evaluate this setup',
      'no_active_setup':        'No active setup detected for this stock',
    };
    return avoid(reasonMap[status] || 'Setup rejected by quality gate', 'HIGH');
  }

  // 1c. Liquidity failure — cannot safely exit
  if (!liquidityPass || exitRisk === 'HIGH') {
    return avoid(
      !liquidityPass
        ? 'Liquidity too low — cannot safely enter or exit this position'
        : 'High exit risk — volume too thin to exit safely',
      'HIGH'
    );
  }

  // 1d. RR critically low (below floor even for watching)
  if (rr < 1.2) {
    return avoid(`RR ${rr.toFixed(2)}x is too low — minimum 1.2x required to consider entry`, 'HIGH');
  }

  // 1e. Rank D always AVOID
  if (rank === 'D') {
    return avoid('Low-priority setup (Rank D) — not worth the capital risk', 'HIGH');
  }

  // ─── TIER 1.5: MARKET CONTEXT AVOID ────────────────────────────────────────
  if (ctx && ctx.marketContext === 'unfavorable') {
    return avoid(
      `Unfavorable Context: ${ctx.contextWarnings[0] || 'Chart structure is bearish or damaged'}`,
      'HIGH'
    );
  }

  // ─── TIER 2: CONDITIONAL AVOID (secondary safety rules) ───────────────────

  // 2a. Late setup with poor RR (not a buy opportunity)
  if (status === 'late_setup' && rr < 2.0) {
    return avoid(
      `Late entry (${rr.toFixed(2)}x RR) — price has moved too far from ideal zone`,
      'HIGH'
    );
  }

  // ─── TIER 3: WATCH (setup valid, timing not right) ────────────────────────

  // 3a. Explicitly "watch" statuses
  if (WATCH_STATUSES.has(status)) {
    if (status === 'late_setup') {
      // late but RR >= 2.0 — exceptional case, still WAIT
      return wait(
        `Entry is late, but strong RR (${rr.toFixed(2)}x) — monitor for pullback to entry zone`,
        'MEDIUM'
      );
    }
    return wait(
      status === 'watch_only'
        ? `Setup valid but RR (${rr.toFixed(2)}x) is borderline — wait for better structure`
        : 'Setup valid — waiting for price confirmation before entry',
      'MEDIUM'
    );
  }

  // 3b. RR in acceptable but not strong zone (1.5–1.8)
  if (rr < 1.8 && rr >= 1.5) {
    // If rank is C, it's a soft wait
    if (rank === 'C') {
      return wait(
        `RR ${rr.toFixed(2)}x is acceptable but not strong enough for Rank C — watch for improvement`,
        'MEDIUM'
      );
    }
    // Rank B with RR 1.5-1.8 = boundary case — still WAIT unless high score
    if (rank === 'B' && score < 75) {
      return wait(
        `RR ${rr.toFixed(2)}x — solid setup but wait for cleaner entry or stronger confirmation`,
        'MEDIUM'
      );
    }
  }

  // 3c. RR borderline (1.2–1.5) — always wait even if rank is decent
  if (rr < 1.5) {
    return wait(
      `RR ${rr.toFixed(2)}x is below 1.5x threshold — hold off for pullback to improve reward`,
      'LOW'
    );
  }

  // ─── TIER 4: ENTER (all safety checks passed) ─────────────────────────────

  if (!ACTION_STATUSES.has(status)) {
    // Catch-all for any other status that escaped above rules
    return wait('Setup present but entry conditions are not yet firmly met', 'LOW');
  }

  // ─── MARKET CONTEXT WAIT OVERRIDE ───
  if (ctx && ctx.marketContext === 'mixed') {
     return wait(
       `Mixed Context: ${ctx.contextWarnings[0] || 'Awaiting stronger structural confirmation'}`,
       'MEDIUM'
     );
  }

  // 4a. STRONG ENTER: Rank A, RR >= 2.0, liquid, actionable
  if (rank === 'A' && rr >= 2.0) {
    return enter(
      `Premium setup — Rank A, RR ${rr.toFixed(2)}x, liquid counter, entry is attractive now`,
      'HIGH'
    );
  }

  // 4b. SOLID ENTER: Rank B, RR >= 1.8, liquid, actionable
  if (rank === 'B' && rr >= 1.8 && ACTION_STATUSES.has(status)) {
    const confidence: DecisionConfidence = score >= 75 ? 'HIGH' : 'MEDIUM';
    return enter(
      `Solid Rank B setup — RR ${rr.toFixed(2)}x with valid entry zone and good liquidity`,
      confidence
    );
  }

  // 4c. Borderline ENTER: Rank A but RR 1.8-2.0 (not quite perfect)
  if (rank === 'A' && rr >= 1.8) {
    return enter(
      `Rank A setup with RR ${rr.toFixed(2)}x — good entry opportunity, manage position size carefully`,
      'MEDIUM'
    );
  }

  // 4d. Anything else that passed all filters = WAIT (conservative default)
  return wait(
    `Setup quality does not meet ENTER threshold — RR ${rr.toFixed(2)}x or rank (${rank}) needs to improve`,
    'MEDIUM'
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function enter(reason: string, confidence: DecisionConfidence): DecisionOutput {
  return { tradeDecision: 'ENTER', decisionReason: reason, decisionConfidence: confidence };
}

function wait(reason: string, confidence: DecisionConfidence): DecisionOutput {
  return { tradeDecision: 'WAIT', decisionReason: reason, decisionConfidence: confidence };
}

function avoid(reason: string, confidence: DecisionConfidence): DecisionOutput {
  return { tradeDecision: 'AVOID', decisionReason: reason, decisionConfidence: confidence };
}
