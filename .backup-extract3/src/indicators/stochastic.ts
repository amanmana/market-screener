import { Candle } from "../types/market";

/**
 * Calculate Stochastic Oscillator %K and %D
 * Default 14,3,3
 */
export function calculateStochastic(
  candles: Candle[],
  kPeriod: number = 14,
  dPeriod: number = 3,
  sPeriod: number = 3
): { k: number[]; d: number[] } {
  const kRaw: number[] = [];
  const kSmooth: number[] = [];
  const d: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) {
      kRaw.push(0);
      continue;
    }

    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const lowMin = Math.min(...slice.map(c => c.low));
    const highMax = Math.max(...slice.map(c => c.high));
    const currentClose = candles[i].close;

    if (highMax === lowMin) {
      kRaw.push(0);
    } else {
      kRaw.push(((currentClose - lowMin) / (highMax - lowMin)) * 100);
    }
  }

  // Smooth %K
  for (let i = 0; i < kRaw.length; i++) {
    if (i < sPeriod - 1) {
      kSmooth.push(0);
      continue;
    }
    const sum = kRaw.slice(i - sPeriod + 1, i + 1).reduce((a, b) => a + b, 0);
    kSmooth.push(sum / sPeriod);
  }

  // Calculate %D (SMA of smoothed %K)
  for (let i = 0; i < kSmooth.length; i++) {
    if (i < dPeriod - 1) {
      d.push(0);
      continue;
    }
    const sum = kSmooth.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0);
    d.push(sum / dPeriod);
  }

  return { k: kSmooth, d };
}
