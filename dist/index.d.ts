import Emittery from 'emittery';
export declare class FtxWS extends Emittery {
    private readonly clientList;
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
    subscribeTrades(symbol: string): void;
    unsubscribeTrades(symbol: string): void;
    subscribeCandle(symbol: string, interval: string): void;
    unsubscribeCandle(symbol: string, interval: string): void;
    closeConnection(): void;
    isSocketOpen(): boolean;
    isSocketConnecting(): boolean;
    getSubscriptionNumber(): number;
    private launchTimerDisconnected;
    private getLastClient;
    private emitSubscriptions;
    private checkDisconnectedClients;
}
