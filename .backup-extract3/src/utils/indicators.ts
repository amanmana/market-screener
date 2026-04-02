
export const calculateSMA = (data: number[], period: number): (number | null)[] => {
    const sma: (number | null)[] = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        const slice = data.slice(i - period + 1, i + 1);
        const sum = slice.reduce((a, b) => a + b, 0);
        sma[i] = sum / period;
    }
    return sma;
};

/**
 * Wilder's Smoothing (as used in RSI and ATR)
 */
export const calculateWilderRSI = (data: number[], period: number = 14): (number | null)[] => {
    if (data.length <= period) return new Array(data.length).fill(null);
    
    const rsi: (number | null)[] = new Array(data.length).fill(null);
    let gains = 0;
    let losses = 0;

    // Initial average gain/loss
    for (let i = 1; i <= period; i++) {
        const diff = data[i] - data[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    rsi[period] = 100 - (100 / (1 + (avgGain / (avgLoss || 0.00001))));

    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        const gain = diff >= 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        rsi[i] = 100 - (100 / (1 + (avgGain / (avgLoss || 0.00001))));
    }

    return rsi;
};

/**
 * Stochastic 14, 3, 3 - Standard TradingView-style
 */
export const calculateStochastic = (highs: number[], lows: number[], closes: number[], kPeriod: number = 14, kSmooth: number = 3, dSmooth: number = 3) => {
    const pk: (number | null)[] = new Array(closes.length).fill(null);
    
    for (let i = kPeriod - 1; i < closes.length; i++) {
        const lowSlice = lows.slice(i - kPeriod + 1, i + 1);
        const highSlice = highs.slice(i - kPeriod + 1, i + 1);
        const minLow = Math.min(...lowSlice);
        const maxHigh = Math.max(...highSlice);
        
        if (maxHigh === minLow) pk[i] = 50;
        else pk[i] = ((closes[i] - minLow) / (maxHigh - minLow)) * 100;
    }

    // Smoothed %K
    const kRaw = pk.map(v => v === null ? 0 : v);
    const kSma = calculateSMA(kRaw, kSmooth);
    const slowK = kSma.map((v, idx) => pk[idx] === null ? null : v);

    // %D (SMA of %K)
    const dRaw = slowK.map(v => v === null ? 0 : v);
    const dSma = calculateSMA(dRaw, dSmooth);
    const slowD = dSma.map((v, idx) => slowK[idx] === null ? null : v);

    return { k: slowK, d: slowD };
};

/**
 * Average True Range (Wilder's Smoothing)
 */
export const calculateATR = (highs: number[], lows: number[], closes: number[], period: number = 14): (number | null)[] => {
    if (closes.length <= period) return new Array(closes.length).fill(null);
    
    const tr: number[] = [0]; // TR for first candle is 0 or high-low
    for(let i=1; i<closes.length; i++) {
        tr.push(Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i-1]),
            Math.abs(lows[i] - closes[i-1])
        ));
    }

    const atr: (number | null)[] = new Array(closes.length).fill(null);
    let sumTR = tr.slice(1, period + 1).reduce((a,b) => a+b, 0);
    atr[period] = sumTR / period;

    for(let i=period+1; i<closes.length; i++) {
        atr[i] = (atr[i-1]! * (period - 1) + tr[i]) / period;
    }
    return atr;
};

export const detectPivotLevels = (closes: number[], highs: number[], lows: number[], window: number = 5) => {
    // We need enough data
    const len = highs.length;
    if (len < window * 2 + 1) {
        const lastHigh = highs[len-1] || 0;
        const lastLow = lows[len-1] || 0;
        return { support: lastLow, resistance: lastHigh, allSupport: [lastLow], allResistance: [lastHigh] };
    }

    const sPivots: number[] = [];
    const rPivots: number[] = [];

    // Identify structural peaks and troughs
    for (let i = window; i < len - window; i++) {
        const currentHigh = highs[i];
        const currentLow = lows[i];
        
        let isStructuralHigh = true;
        let isStructuralLow = true;

        for (let j = i - window; j <= i + window; j++) {
            if (i === j) continue;
            if (highs[j] > currentHigh) isStructuralHigh = false;
            if (lows[j] < currentLow) isStructuralLow = false;
        }

        if (isStructuralHigh) rPivots.push(currentHigh);
        if (isStructuralLow) sPivots.push(currentLow);
    }

    // Noise merging: group levels within 1.5% and take the most conservative one
    const mergeLevels = (arr: number[], type: 'r' | 's') => {
        if (arr.length === 0) return [];
        const sorted = [...new Set(arr)].sort((a,b) => a - b);
        const merged: number[] = [];
        
        sorted.forEach(val => {
            if (merged.length === 0) {
                merged.push(val);
            } else {
                const prev = merged[merged.length - 1];
                if ((val - prev) / prev < 0.015) {
                   // Keep the higher one for resistance, lower for support
                   if (type === 'r') merged[merged.length-1] = val;
                } else {
                   merged.push(val);
                }
            }
        });
        return merged;
    };

    const finalSupport = mergeLevels(sPivots, 's');
    const finalResistance = mergeLevels(rPivots, 'r');

    // Nearest levels for Short Term Trader
    const defaultSupport = finalSupport.length > 0 ? finalSupport[finalSupport.length - 1] : lows[len-1];
    const defaultResist = finalResistance.length > 0 ? finalResistance[finalResistance.length - 1] : highs[len-1];

    return { 
        support: defaultSupport, 
        resistance: defaultResist, 
        allSupport: finalSupport, 
        allResistance: finalResistance 
    };
};

/**
 * Finds the nearest VALID resistance above current price
 */
export const findNearestResistance = (price: number, r: number[], fallback: number): number => {
    // Filter out levels that have already been clearly breached
    const validAbove = r.filter(v => v > price * 1.002).sort((a,b) => a - b);
    
    if (validAbove.length > 0) return validAbove[0];
    
    // If fallback is also below/too close, try to find a macro high in history
    if (fallback <= price * 1.002) return price * 1.15; // Increased safety fallback
    
    return fallback;
};
