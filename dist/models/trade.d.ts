import { RawTrade } from './raw-trade';
export interface Trade extends RawTrade {
    info: RawTrade;
    symbol: string;
    timestamp: number;
}
