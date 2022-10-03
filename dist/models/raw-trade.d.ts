export interface RawTrade {
    id: number;
    price: number;
    size: number;
    side: string;
    liquidation: boolean;
    time: string;
}
