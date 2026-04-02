
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
            suggestedEntry: 0,
            targetPrice: target || 0,
            stopLoss: stop || 0
        };
    }

    if (target <= stop) {
        return {
            entryStatus: 'invalid' as EntryStatus,
            currentRR: 0,
            suggestedEntry: 0,
            targetPrice: target,
            stopLoss: stop
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
    if (currentPrice <= stop) status = 'invalid';
    else if (currentRR >= idealRRThreshold) status = 'ideal';
    else if (currentRR >= minRRThreshold) status = 'acceptable';
    else status = 'late_setup';

    return {
        idealEntry,
        acceptableEntry,
        suggestedEntry: roundToTick(suggestedEntry, tick),
        entryRangeLow: idealEntry, 
        entryRangeHigh: acceptableEntry,
        currentRR,
        entryStatus: status
    };
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

export const getExtensionPercent = (price: number, ma: number): number => {
    return ((price - ma) / ma) * 100;
};
