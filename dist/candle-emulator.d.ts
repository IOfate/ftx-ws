import Emittery from 'emittery';
export declare class CandleEmulator {
    private readonly symbol;
    private readonly interval;
    private readonly globalEmitter;
    private readonly internalEmitter;
    private readonly gapBetweenCandleTrigger;
    private readonly intervalMs;
    private currentCandle;
    private unSubFn;
    constructor(symbol: string, interval: string, globalEmitter: Emittery, internalEmitter: Emittery);
    launch(): void;
    reset(): void;
    private processNextTicker;
    private getNextCandle;
    private resetCurrentCandle;
    private updateCurrentCandle;
}
