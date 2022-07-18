import Emittery from 'emittery';
export declare class FtxWS extends Emittery {
    private readonly clientTickerList;
    private readonly clientCandleList;
    private readonly maxSubscriptions;
    private readonly subscriptionsEvent;
    private readonly intervalCheckConnection;
    private timerDisconnectedClient;
    constructor();
    subscribeTicker(symbol: string): void;
    subscribeTickers(symbols: string[]): void;
    unsubscribeTicker(symbol: string): void;
    unsubscribeTickers(symbols: string[]): void;
    subscribeCandle(symbol: string, interval: string): void;
    closeConnection(): void;
    isSocketOpen(): boolean;
    isSocketConnecting(): boolean;
    getSubscriptionNumber(): number;
    private launchTimerDisconnected;
    private getLastClient;
    private emitSubscriptions;
    private checkDisconnectedClients;
}
