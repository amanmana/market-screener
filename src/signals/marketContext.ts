import { Candle } from "../types/market";
import { SignalType, MarketContextInfo } from "../types/signals";
import { calculateSMA, detectStructuralPivots } from "../utils/indicators";

export function evaluateMarketContext(candles: Candle[], signalType: SignalType): MarketContextInfo {
    if (candles.length < 50) {
        return {
            trendBias: 'neutral',
            structureState: 'consolidation',
            marketContext: 'mixed',
            contextWarnings: ['Insufficient data for full context analysis']
        };
    }

    const closes = candles.map(c => Number(c.close));
    const highs = candles.map(c => Number(c.high));
    const lows = candles.map(c => Number(c.low));
    
    const maxIdx = closes.length - 1;
    const currentPrice = closes[maxIdx];

    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);

    const currentSma20 = sma20[maxIdx] || 0;
    const currentSma50 = sma50[maxIdx] || 0;
    const prevSma20 = sma20[maxIdx - 1] || 0;
    const prevSma50 = sma50[maxIdx - 1] || 0;
    
    // Slopes
    const sma20Slope = (currentSma20 - prevSma20) / prevSma20;
    const sma50Slope = (currentSma50 - prevSma50) / prevSma50;

    // Structural Pivots (detect peaks and troughs)
    const { support: sPivots, resistance: rPivots } = detectStructuralPivots(highs, lows, 5);
    
    const recentResistances = rPivots.filter(p => p.index > maxIdx - 20);
    
    // Nearest meaningful resistance above
    const overheadResistances = rPivots.filter(p => p.price > currentPrice && p.index > maxIdx - 30).slice(0, 2);
    
    // Resistance within ~4% above current price is an overhead trap
    const hasOverheadTrap = overheadResistances.length > 0 && 
                            overheadResistances[0].price < currentPrice * 1.04; 

    // Trend Bias Setup
    let trendBias: MarketContextInfo['trendBias'] = 'neutral';
    if (currentPrice > currentSma50 && currentSma20 > currentSma50 && sma50Slope > -0.001) {
        trendBias = 'bullish';
    } else if (currentPrice < currentSma50 && currentSma20 < currentSma50 && sma50Slope < 0.001) {
        trendBias = 'bearish';
    }

    // Structure State Setup
    let structureState: MarketContextInfo['structureState'] = 'consolidation';
    const warnings: string[] = [];

    // Check for Lower Highs (bearish intact)
    let lowerHighsIntact = false;
    if (recentResistances.length >= 2) {
        const lastR = recentResistances[recentResistances.length - 1];
        const prevR = recentResistances[recentResistances.length - 2];
        if (lastR.price < prevR.price && currentPrice < lastR.price * 1.02) { // Price has not decisively broken last R
            lowerHighsIntact = true;
        }
    }

    if (trendBias === 'bullish') {
        if (currentPrice > currentSma20 && sma20Slope > 0) {
            structureState = 'healthy_trend';
        } else {
            structureState = 'pullback_in_trend';
        }
        
        if (currentPrice < currentSma50) {
           structureState = 'damaged_structure';
           warnings.push('Price broke below SMA50 despite broader bullish alignment');
        }
    } else if (trendBias === 'bearish') {
        if (currentPrice < currentSma20) {
            structureState = 'downtrend';
            if (lowerHighsIntact) {
                warnings.push('Lower highs firmly intact');
            }
        } else {
            // Price > SMA 20 but SMA 20 < SMA 50
            if (currentPrice > currentSma50) {
                structureState = 'early_reversal';
            } else {
                structureState = 'weak_rebound';
                if (hasOverheadTrap) {
                    warnings.push('Bouncing directly into overhead structural resistance');
                }
            }
        }
    } else {
        if (currentPrice > currentSma20 && currentPrice > currentSma50) {
            structureState = 'early_reversal';
        } else if (currentPrice < currentSma20 && currentPrice < currentSma50) {
             structureState = 'damaged_structure';
        }
    }
    
    // Cross check Context Quality
    let marketContext: MarketContextInfo['marketContext'] = 'mixed';
    
    if (structureState === 'healthy_trend' || structureState === 'pullback_in_trend') {
       marketContext = 'favorable';
    } else if (structureState === 'downtrend') {
       marketContext = 'unfavorable';
       warnings.push('Counter-trend: Strong downtrend conditions');
    } else if (structureState === 'weak_rebound') {
       if (signalType === SignalType.BUY_R) {
           marketContext = 'mixed'; // Acceptable for reversal but risky
           warnings.push('Early rebound: longer-term structure remains weak');
       } else {
           marketContext = 'unfavorable';
           warnings.push('Trend continuation signals trapped in a weak rebound');
       }
    } else if (structureState === 'damaged_structure') {
       marketContext = 'unfavorable';
       warnings.push('Broader structure is damaged');
    } else if (structureState === 'early_reversal') {
       marketContext = 'mixed'; // Needs confirmation
       if (hasOverheadTrap) warnings.push('Early reversal but facing near-term resistance trap');
    }

    // Strategy-specific contextual blocks
    if ((signalType === SignalType.BUY_T || signalType === SignalType.REBUY) && trendBias === 'bearish') {
        marketContext = 'unfavorable';
        warnings.push(`${signalType} setup typically requires a favorable bullish backdrop`);
    }
    
    // Trap warning injection
    if (hasOverheadTrap && signalType !== SignalType.SELL && signalType !== SignalType.WARN && signalType !== SignalType.PRE_WARN) {
        if (!warnings.some(w => w.includes('overhead'))) {
            warnings.push('Price is trapped below recent overhead resistance');
        }
    }

    return {
        trendBias,
        structureState,
        marketContext,
        contextWarnings: warnings
    };
}
