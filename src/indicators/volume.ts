import { Candle } from "../types/market";

/**
 * Calculate Average Volume
 */
export function calculateAverageVolume(candles: Candle[], period: number = 20): number[] {
  const volumes = candles.map(c => c.volume);
  const result: number[] = [];
  
  for (let i = 0; i < volumes.length; i++) {
    if (i < period - 1) {
      result.push(0);
      continue;
    }
    const slice = volumes.slice(i - period + 1, i + 1);
    const sum = slice.reduce((a, b) => a + b, 0);
    result.push(sum / period);
  }
  
  return result;
}

/**
 * Calculate Volume Ratio (Current Volume / Average Volume)
 */
export function getVolumeRatio(candles: Candle[], avgVolumes: number[]): number {
  if (candles.length === 0 || avgVolumes.length === 0) return 0;
  const currentVolume = candles[candles.length - 1].volume;
  const avgVolume = avgVolumes[avgVolumes.length - 1];
  return avgVolume === 0 ? 0 : currentVolume / avgVolume;
}
