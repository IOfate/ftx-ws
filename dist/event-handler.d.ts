import Emittery from 'emittery';
import { Ticker } from './models/ticker';
export declare class EventHandler {
    private readonly emitter;
    private readonly maxWaiting;
    private lastTickers;
    private mapResolveWaitEvent;
    constructor(emitter: Emittery);
    waitForEvent(id: string, callback?: (result: boolean) => void): Promise<boolean>;
    processMessage(message: string): void;
    deleteTickerCache(id: string): void;
    clearCache(): void;
    getLastTickers(): {
        [pair: string]: Ticker;
    };
    private getReceivedEventKey;
    private processRawTicker;
}
