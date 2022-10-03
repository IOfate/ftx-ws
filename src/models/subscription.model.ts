export interface Subscription {
  type: 'ticker' | 'candle' | 'trades';
  timestamp: number;
  symbol: string;
}
