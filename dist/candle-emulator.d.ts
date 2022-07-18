import Emittery from 'emittery';
export declare class CandleEmulator {
    private readonly symbol;
    private readonly interval;
    private readonly globalEmitter;
    private readonly gapBetweenCandleTrigger;
    private readonly intervalMs;
    private currentCandle;
    constructor(symbol: string, interval: string, globalEmitter: Emittery);
    launch(): void;
    private processNextTicker;
    private getNextCandle;
    private resetCurrentCandle;
    private updateCurrentCandle;
}
