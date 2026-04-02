import { Candle } from "../types/market";
import { MarketConfig, BURSA_CONFIG } from "../types/signals";

export interface LiquidityResult {
    liquidityPass: boolean;
    liquidityFlags: string[];
    exitRisk: 'LOW' | 'MEDIUM' | 'HIGH';
    avgTradedValue20: number;
    medianTradedValue20: number;
    activeDays20: number;
}

/**
 * Calculates liquidity and exit-risk metrics per BURSA standards.
 */
export const calculateLiquidity = (candles: Candle[], config: MarketConfig = BURSA_CONFIG): LiquidityResult => {
    const historical = candles.slice(-20);
    if (historical.length === 0) {
        return {
            liquidityPass: false,
            liquidityFlags: ['INSUFFICIENT_DATA'],
            exitRisk: 'HIGH',
            avgTradedValue20: 0,
            medianTradedValue20: 0,
            activeDays20: 0
        };
    }

    const tradedValues = historical.map(c => c.close * (c.volume || 0));
    const avgTradedValue20 = tradedValues.reduce((a, b) => a + b, 0) / historical.length;
    
    // Sort for median
    const sortedVals = [...tradedValues].sort((a, b) => a - b);
    const medianTradedValue20 = sortedVals[Math.floor(sortedVals.length / 2)];

    const activeDays20 = tradedValues.filter(v => v >= config.activeDaysValueThreshold).length;

    const flags: string[] = [];
    if (avgTradedValue20 < config.minTradedValueAvg) flags.push('LOW_LIQUIDITY');
    if (medianTradedValue20 < config.minTradedValueMedian) flags.push('THIN_COUNTER');
    if (activeDays20 < config.activeDaysThreshold) flags.push('EXIT_RISK');

    const score = (
        (avgTradedValue20 >= config.minTradedValueAvg ? 1 : 0) +
        (medianTradedValue20 >= config.minTradedValueMedian ? 1 : 0) +
        (activeDays20 >= config.activeDaysThreshold ? 1 : 0)
    );

    let exitRisk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (score === 3) exitRisk = 'LOW';
    else if (score >= 1) exitRisk = 'MEDIUM';
    else exitRisk = 'HIGH';

    return {
        liquidityPass: flags.length === 0,
        liquidityFlags: flags,
        exitRisk,
        avgTradedValue20,
        medianTradedValue20,
        activeDays20
    };
};
