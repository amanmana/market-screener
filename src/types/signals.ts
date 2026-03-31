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

export interface SignalResult {
  type: SignalType;
  price?: number;
  reason?: string;
  timestamp?: string;
  ticker?: string;
  entryRangeLow?: number;
  entryRangeHigh?: number;
  isCaution?: boolean;
  sessionHigh?: number;
  sessionLow?: number;
  isBTST?: boolean;
  btstTarget?: number;
  stopLoss?: number;
  name?: string;
}

export interface ScreenerBatchResponse {
    results: SignalResult[];
    total?: number;
    offset?: number;
    count?: number;
}
