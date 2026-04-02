export enum SignalType {
  BUY_T = 'BUY-T',
  BUY_R = 'BUY-R',
  REBUY = 'REBUY',
  PRE_WARN = 'PRE-WARN',
  WARN = 'WARN',
  SELL = 'SELL',
  SWING = 'SWING',
  NONE = 'NONE'
}

export type EntryStatus = 
  | 'ideal' 
  | 'acceptable' 
  | 'late_setup' 
  | 'waiting_confirmation' 
  | 'incomplete_trade_plan' 
  | 'insufficient_data'
  | 'invalid' 
  | 'no_active_setup';

export interface MarketConfig {
  market: 'BURSA' | 'US';
  currency: string;
  minTradedValueAvg: number;
  minTradedValueMedian: number;
  activeDaysThreshold: number;
  activeDaysValueThreshold: number;
}

export const BURSA_CONFIG: MarketConfig = {
  market: 'BURSA',
  currency: 'MYR',
  minTradedValueAvg: 500000,
  minTradedValueMedian: 300000,
  activeDaysThreshold: 12,
  activeDaysValueThreshold: 200000
};

export interface SignalResult {
  signal: SignalType;
  setupFamily?: string;   // SWING, REBUY, BUY-T, etc.
  confirmed?: boolean;     // EOD confirmed
  previewOnly?: boolean;   // Live preview
  confidence?: number;     // 0-100
  price?: number;
  
  // Entry Analysis
  entryRangeLow?: number;
  entryRangeHigh?: number;
  suggestedEntry?: number;
  idealEntry?: number;
  acceptableEntry?: number;
  
  // Levels
  supportLevel?: number;
  resistanceLevel?: number;
  stopLoss?: number;
  targetPrice?: number;
  
  // Risk-Reward
  rrRatio?: number;   // Expected setup RR
  currentRR?: number; // RR at current live price
  
  // Status & Explanation
  entryStatus?: EntryStatus;
  cautionFlags?: string[];
  isCaution?: boolean;
  explanation?: string;
  rejectionReason?: string;

  // Liquidity & Exit Risk
  liquidityPass?: boolean;
  liquidityFlags?: string[];
  exitRisk?: 'LOW' | 'MEDIUM' | 'HIGH';
  avgTradedValue20?: number;
  medianTradedValue20?: number;
  activeDays20?: number;

  // Ranking System
  setupScore?: number;    // 0-100
  setupRank?: string;     // A, B, C, D
  scoreBreakdown?: {
    liquidity: number;
    rr: number;
    structure: number;
    trend: number;
  };

  // Compatibility / Internal
  timestamp?: string;
  ticker?: string;
  name?: string;
  isBTST?: boolean;
  btstMetadata?: {
    target: number;
    cl: number;
    reason: string;
  };
  
  // Legacy mappings
  type?: SignalType; 
  reason?: string;
}

export interface WatchlistBatchResponse {
    results: SignalResult[];
    total?: number;
    offset?: number;
}
