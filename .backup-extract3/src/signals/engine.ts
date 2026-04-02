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

/**
 * Calculates a proprietary setup score (0-100) based on multiple factors.
 * Focus: Tradability, Liquidity, and Risk-Reward.
 */
function calculateSetupScore(res: SignalResult): number {
    if (res.signal === SignalType.NONE) return 0;
    
    let score = 0;

    // 1. Entry Actionability (CRITICAL: 40 pts)
    if (res.entryStatus === 'ideal') score += 40;
    else if (res.entryStatus === 'acceptable') score += 25;
    else if (res.entryStatus === 'late_setup') score += 15; // Changed from -20 to +15 to preserve C/B rank
    else if (res.entryStatus === 'waiting_confirmation') score += 10;
    else if (res.entryStatus === 'incomplete_trade_plan') {
       score -= 40; 
    }

    // 2. Liquidity & Exit Safety (30 pts)
    if (res.liquidityPass) score += 30;
    else {
        if (res.exitRisk === 'HIGH') score -= 60; 
        else score -= 20;
    }

    // 3. Risk-Reward Quality (20 pts)
    const currentRR = res.currentRR || 0;
    if (currentRR >= 2.5) score += 25;
    else if (currentRR >= 1.8) score += 15;
    else if (currentRR >= 1.3) score += 5;
    else score -= 10;

    // 4. Trend & Family Bonus (10 pts)
    const signalWeights: Record<string, number> = {
        [SignalType.REBUY]: 10,
        [SignalType.BUY_T]: 8,
        [SignalType.SWING]: 6,
        [SignalType.BUY_R]: 4
    };
    score += signalWeights[res.signal] || 0;

    return Math.max(0, Math.min(100, score));
}

function getRankLabel(score: number): string {
    if (score >= 82) return 'A'; // Elite
    if (score >= 65) return 'B'; // Good
    if (score >= 40) return 'C'; // Acceptable/Late but still tradable
    return 'D'; // Avoid / Risk too high
}

export async function getLatestSignal(candles: Candle[], isLive: boolean = false): Promise<SignalResult> {
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

  // 2. RUN STRATEGIES IN PRIORITY
  const strategies = [
    { name: 'SELL', fn: checkSell },
    { name: 'WARN', fn: checkWarn },
    { name: 'REBUY', fn: checkRebuy },
    { name: 'BUY-T', fn: checkBuyT },
    { name: 'SWING', fn: checkSwing },
    { name: 'BUY-R', fn: checkBuyR }
  ];

  let bestSignal: SignalResult | null = null;
  let fallbackSignal: SignalResult | null = null;
  const rejections: string[] = [];

  for (const s of strategies) {
    const res = s.fn(candles) as SignalResult;
    if (res && res.signal !== SignalType.NONE) {
        bestSignal = res;
        break; 
    } else if (res) {
        // Capture setups that are forming or already reached target, so they aren't lost to 'no setup'
        if (['late_setup', 'waiting_confirmation'].includes(res.entryStatus || '')) {
            if (!fallbackSignal) {
                fallbackSignal = { ...res, signal: s.name as SignalType };
            }
        }
        if (res.rejectionReason) {
            rejections.push(`${s.name}: ${res.rejectionReason}`);
        }
    }
  }

  // Initialize output with best signal, or a valid pending setup, or generic NONE
  let output: SignalResult = bestSignal || fallbackSignal || {
    signal: SignalType.NONE,
    price: current.close,
    rejectionReason: rejections.join(" | ")
  };

  // Add liquidity metadata
  Object.assign(output, liq);

  // Enhance with Ranking
  output.setupScore = calculateSetupScore(output);
  output.setupRank = getRankLabel(output.setupScore);
  output.confirmed = !isLive;
  output.previewOnly = isLive;
  output.timestamp = current.price_date;
  
  // Backward compatibility
  output.type = output.signal;
  output.reason = output.explanation || output.rejectionReason;

  return output;
}
