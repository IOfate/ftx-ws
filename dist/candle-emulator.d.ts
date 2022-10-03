import Emittery from 'emittery';
export declare class CandleEmulator {
    private readonly symbol;
    private readonly interval;
    private readonly globalEmitter;
    private readonly internalEmitter;
    private readonly ftxApiUrl;
    private readonly intervalMs;
    private currentCandle;
    private unSubFn;
    private timestampDivider;
    constructor(symbol: string, interval: string, globalEmitter: Emittery, internalEmitter: Emittery);
    launch(): Promise<void>;
    reset(): void;
    private processNextTrades;
    private resetCurrentCandle;
    private updateCurrentCandle;
    private getCurrentCandleFromApi;
}
