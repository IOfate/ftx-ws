import Emittery from 'emittery';
import { Ticker } from './models/ticker';
import { Trade } from './models/trade';
export declare class EventHandler {
    private readonly globalEmitter;
    private readonly internalEmitter;
    private readonly maxWaiting;
    private lastTickers;
    private lastTrades;
    private mapResolveWaitEvent;
    constructor(globalEmitter: Emittery, internalEmitter: Emittery);
    waitForEvent(id: string, callback?: (result: boolean) => void): Promise<boolean>;
    processMessage(message: string): void;
    deleteTickerCache(id: string): void;
    clearCache(): void;
    getLastTickers(): {
        [pair: string]: Ticker;
    };
    getLastTrades(): {
        [pair: string]: Trade;
    };
    private getReceivedEventKey;
    private processRawTicker;
    private processRawTrades;
}
