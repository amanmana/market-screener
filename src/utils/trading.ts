
import { SignalResult, EntryStatus } from "../types/signals";

/**
 * Calculate Reward/Risk Ratio
 */
export const calculateRR = (entry: number, target: number, stop: number): number => {
    const risk = entry - stop;
    const reward = target - entry;
    if (risk <= 0) return 0;
    return Number((reward / risk).toFixed(2));
};

/**
 * Derives suggested entry based on Target, Stop, and desired RR
 * Entry = (Target + RR * StopLoss) / (1 + RR)
 */
export const calculateEntryForRR = (target: number, stop: number, rr: number): number => {
    if (rr <= 0) return 0;
    return (target + rr * stop) / (1 + rr);
};

export const getBursaTick = (price: number): number => {
    if (price < 1) return 0.005; 
    if (price < 10) return 0.01; 
    if (price < 100) return 0.02;
    return 0.10;
};

export const roundToTick = (val: number, tick: number): number => {
    return Math.round(val / tick) * tick;
};

/**
 * Comprehensive Entry Analysis (RR-Based)
 */
export const analyzeEntry = (
    currentPrice: number, 
    target: number, 
    stop: number, 
    idealRRThreshold: number = 1.8, 
    minRRThreshold: number = 1.3
) => {
    const tick = getBursaTick(currentPrice);

    // Distinguish between no setup and incomplete fields
    if (!target || !stop) {
        return { 
            entryStatus: (target || stop) ? 'incomplete_trade_plan' : 'no_active_setup' as EntryStatus,
            currentRR: 0,
            suggestedEntry: currentPrice,
            targetPrice: target || 0,
            stopLoss: stop || 0,
            rejectionReason: (target || stop) ? 'missing_tp_or_sl' : 'no_levels_found'
        };
    }
    
    // 0. SAFETY: Inconsistent TP/SL
    if (target <= stop) {
        return {
            targetPrice: target,
            stopLoss: stop,
            suggestedEntry: currentPrice,
            currentRR: 0,
            entryStatus: 'invalid' as EntryStatus,
            rejectionReason: 'mismatched_tp_sl',
            explanation: `Target (RM ${target.toFixed(3)}) is below StopLoss (RM ${stop.toFixed(3)}). Plan is invalid.`
        };
    }

    // Formulas: Entry = (Target + RR * StopLoss) / (1 + RR)
    const idealEntry = roundToTick(calculateEntryForRR(target, stop, idealRRThreshold), tick);
    const acceptableEntry = roundToTick(calculateEntryForRR(target, stop, minRRThreshold), tick);
    const currentRR = calculateRR(currentPrice, target, stop);

    // Entry Suggestion Logic:
    // 1. If current price offers BETTER RR than ideal, suggestedEntry = currentPrice (Market Entry)
    // 2. Otherwise, suggestedEntry = idealEntry (Buy on Pullback)
    let suggestedEntry = currentRR >= idealRRThreshold ? currentPrice : idealEntry;

    // Do not suggest entry above current price unless it's a breakout (not handled here yet)
    if (suggestedEntry > currentPrice) {
        suggestedEntry = currentPrice; 
    }

    let status: EntryStatus = 'late_setup';
    let rejection = '';
    
    if (currentPrice <= stop) {
        status = 'invalid';
        rejection = 'price_below_sl';
    }
    else if (currentRR >= idealRRThreshold) status = 'ideal';
    else if (currentRR >= minRRThreshold) status = 'acceptable';
    else {
        status = 'late_setup';
        rejection = 'low_rr';
    }

    return {
        idealEntry,
        acceptableEntry,
        suggestedEntry: roundToTick(suggestedEntry, tick),
        targetPrice: target,
        stopLoss: stop,
        entryRangeLow: idealEntry, 
        entryRangeHigh: acceptableEntry,
        currentRR,
        entryStatus: status,
        rejectionReason: rejection
    };
};

export const getExtensionPercent = (price: number, ma: number): number => {
    return ((price - ma) / ma) * 100;
};

/**
 * NEW: Position Sizing Engine (Bursa Focused)
 */
export const DEFAULT_RISK_CONFIG = {
    accountSize: 20000,      // Default 20k MYR
    riskPctPerTrade: 1.5,    // 1.5% Risk per trade
    maxPositionPct: 20,      // Max 20% capital in one stock
    boardLotSize: 100        // Bursa Standard
};

export const calculatePositionSize = (
    entry: number,
    stop: number,
    config: any = DEFAULT_RISK_CONFIG
) => {
    if (!entry || !stop || entry <= stop) {
        return {
            riskPerShare: 0,
            suggestedPositionShares: 0,
            suggestedPositionLots: 0,
            capitalRequired: 0,
            riskAmount: 0,
            profitAmount: 0,
            rewardPerShare: 0,
            fitsRiskBudget: false,
            fitsCapitalBudget: false,
            explanation: "Invalid risk levels."
        };
    }

    const { targetPrice = 0 } = config;

    const riskPerTrade = (config.accountSize * (config.riskPctPerTrade || config.riskPerTrade || 1.5)) / 100;
    const maxCapitalPerTrade = (config.accountSize * (config.maxPositionPct || config.maxPositionSize || 20)) / 100;
    
    const riskPerShare = entry - stop;
    
    // 1. Risk-Based Share Count
    let shares = Math.floor(riskPerTrade / riskPerShare);
    
    // 2. Capital Constraint
    const capitalAtRiskBasedSize = shares * entry;
    if (capitalAtRiskBasedSize > maxCapitalPerTrade) {
        shares = Math.floor(maxCapitalPerTrade / entry);
    }

    // 3. Bursa Lot Rounding (1 lot = 100 shares)
    const lots = Math.floor(shares / config.boardLotSize);
    const finalShares = lots * config.boardLotSize;

    const capitalRequired = finalShares * entry;
    const actualRiskAmount = finalShares * riskPerShare;
    
    const rewardPerShare = targetPrice > entry ? (targetPrice - entry) : 0;
    const profitAmount = finalShares * rewardPerShare;

    return {
        riskPerShare,
        rewardPerShare,
        suggestedPositionShares: finalShares,
        suggestedPositionLots: lots,
        capitalRequired: Number(capitalRequired.toFixed(2)),
        riskAmount: Number(actualRiskAmount.toFixed(2)),
        profitAmount: Number(profitAmount.toFixed(2)),
        fitsRiskBudget: actualRiskAmount <= (riskPerTrade * 1.1),
        fitsCapitalBudget: capitalRequired <= maxCapitalPerTrade,
        explanation: finalShares > 0 
            ? `Risk RM ${actualRiskAmount.toFixed(0)} (${((actualRiskAmount/config.accountSize)*100).toFixed(1)}% acct).`
            : `Capital too small.`
    };
};
