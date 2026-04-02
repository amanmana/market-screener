export const calculateSMA = (data: number[], period: number): (number | null)[] => {
    const sma: (number | null)[] = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        const slice = data.slice(i - period + 1, i + 1);
        const sum = slice.reduce((a, b) => a + b, 0);
        sma[i] = sum / period;
    }
    return sma;
};

export const calculateWilderRSI = (data: number[], period: number = 14): (number | null)[] => {
    if (data.length <= period) return new Array(data.length).fill(null);
    const rsi: (number | null)[] = new Array(data.length).fill(null);
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = data[i] - data[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period, avgLoss = losses / period;
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

export const calculateStochastic = (highs: number[], lows: number[], closes: number[], kPeriod: number = 14, kSmooth: number = 3, dSmooth: number = 3) => {
    const pk: (number | null)[] = new Array(closes.length).fill(null);
    for (let i = kPeriod - 1; i < closes.length; i++) {
        const lowSlice = lows.slice(i - kPeriod + 1, i + 1);
        const highSlice = highs.slice(i - kPeriod + 1, i + 1);
        const minLow = Math.min(...lowSlice);
        const maxHigh = Math.max(...highSlice);
        if (maxHigh === minLow) pk[i] = 50; else pk[i] = ((closes[i] - minLow) / (maxHigh - minLow)) * 100;
    }
    const kRaw = pk.map(v => v === null ? 0 : v);
    const kSma = calculateSMA(kRaw, kSmooth);
    const slowK = kSma.map((v, idx) => pk[idx] === null ? null : v);
    const dRaw = slowK.map(v => v === null ? 0 : v);
    const dSma = calculateSMA(dRaw, dSmooth);
    const slowD = dSma.map((v, idx) => slowK[idx] === null ? null : v);
    return { k: slowK, d: slowD };
};

export const calculateATR = (highs: number[], lows: number[], closes: number[], period: number = 14): (number | null)[] => {
    if (closes.length <= period) return new Array(closes.length).fill(null);
    const tr: number[] = [0];
    for(let i=1; i<closes.length; i++) {
        tr.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
    }
    const atr: (number | null)[] = new Array(closes.length).fill(null);
    let sumTR = tr.slice(1, period + 1).reduce((a,b) => a+b, 0);
    atr[period] = sumTR / period;
    for(let i=period+1; i<closes.length; i++) atr[i] = (atr[i-1]! * (period - 1) + tr[i]) / period;
    return atr;
};

/**
 * NEW: Detect Structural Support & Resistance
 */
export const detectStructuralPivots = (highs: number[], lows: number[], window: number = 5) => {
    const len = highs.length;
    const rPivots: { price: number; index: number; strength: number }[] = [];
    const sPivots: { price: number; index: number; strength: number }[] = [];
    if (len < window * 2 + 1) return { support: sPivots, resistance: rPivots };
    for (let i = window; i < len - window; i++) {
        const curH = highs[i], curL = lows[i];
        let isH = true, isL = true;
        for (let j = i - window; j <= i + window; j++) {
            if (i === j) continue;
            if (highs[j] > curH) isH = false;
            if (lows[j] < curL) isL = false;
        }
        if (isH) {
            const leftAvg = highs.slice(i-window, i).reduce((a,b)=>a+b,0)/window;
            const rightAvg = highs.slice(i+1, i+window+1).reduce((a,b)=>a+b,0)/window;
            if (curH > leftAvg * 1.002 && curH > rightAvg * 1.002) rPivots.push({ price: curH, index: i, strength: window });
        }
        if (isL) sPivots.push({ price: curL, index: i, strength: window });
    }
    return { support: sPivots, resistance: rPivots };
};

const cleanLevels = (levels: number[], threshold: number = 0.012) => {
    if (levels.length === 0) return [];
    const sorted = [...new Set(levels)].sort((a,b) => a - b);
    const result: number[] = [];
    sorted.forEach(val => {
        if (result.length === 0) result.push(val);
        else {
            const last = result[result.length - 1];
            if ((val - last) / last < threshold) result[result.length - 1] = val;
            else result.push(val);
        }
    });
    return result;
};

export const findMeaningfulResistance = (price: number, highs: number[], lows: number[], strategy: 'REVERSAL' | 'CONTINUATION' | 'SWING') => {
    const { resistance: wideR } = detectStructuralPivots(highs, lows, 10);
    const { resistance: narrowR } = detectStructuralPivots(highs, lows, 5);
    const allR = cleanLevels([...wideR.map(p => p.price), ...narrowR.map(p => p.price)]);
    const validAbove = allR.filter(v => v > price * 1.005);
    if (validAbove.length === 0) return { target: 0, allLevels: allR };
    validAbove.sort((a, b) => a - b);
    let chosen = validAbove[0], next = validAbove[1];
    if (strategy === 'CONTINUATION') {
        if (next && (next - chosen) / chosen < 0.03) chosen = next;
    } else if (strategy === 'SWING') {
        const wideValid = wideR.map(p => p.price).filter(v => v > price * 1.01);
        if (wideValid.length > 0) chosen = wideValid.sort((a,b)=>a-b)[0];
    }
    return { target: chosen, secondary: next, allLevels: allR };
};

export const calculateHeikinAshi = (candles: {open: number, high: number, low: number, close: number}[]) => {
    if (candles.length === 0) return [];
    const ha: {open: number, high: number, low: number, close: number}[] = [];
    let prevOpen = candles[0].open, prevClose = candles[0].close;
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const close = (c.open + c.high + c.low + c.close) / 4;
        const open = i === 0 ? (c.open + c.close) / 2 : (prevOpen + prevClose) / 2;
        const high = Math.max(c.high, open, close);
        const low = Math.min(c.low, open, close);
        ha.push({ open, high, low, close });
        prevOpen = open; prevClose = close;
    }
    return ha;
};
