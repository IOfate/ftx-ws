"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FtxWS = void 0;
const emittery_1 = __importDefault(require("emittery"));
const parse_duration_1 = __importDefault(require("parse-duration"));
/** Root */
const client_1 = require("./client");
class FtxWS extends emittery_1.default {
    constructor() {
        super();
        this.clientList = [];
        this.clientCandleList = [];
        this.maxSubscriptions = 98;
        this.subscriptionsEvent = 'subscriptions';
        this.intervalCheckConnection = (0, parse_duration_1.default)('32s');
        this.launchTimerDisconnected();
    }
    subscribeTicker(symbol) {
        const alreadySubscribed = this.clientList.some((client) => client.hasTickerSubscription(symbol));
        if (alreadySubscribed) {
            return;
        }
        this.getLastClient('ticker').subscribeTicker(symbol);
    }
    subscribeTickers(symbols) {
        symbols.forEach((symbol) => this.subscribeTicker(symbol));
    }
    unsubscribeTicker(symbol) {
        const client = this.clientList.find((client) => client.hasTickerSubscription(symbol));
        if (!client) {
            return;
        }
        client.unsubscribeTicker(symbol);
    }
    unsubscribeTickers(symbols) {
        symbols.forEach((symbol) => this.unsubscribeTicker(symbol));
    }
    subscribeTrades(symbol) {
        const alreadySubscribed = this.clientList.some((client) => client.hasTradesSubscription(symbol));
        if (alreadySubscribed) {
            return;
        }
        this.getLastClient('trades').subscribeTrades(symbol);
    }
    unsubscribeTrades(symbol) {
        const client = this.clientList.find((client) => client.hasTradesSubscription(symbol));
        if (!client) {
            return;
        }
        client.unsubscribeTrades(symbol);
    }
    subscribeCandle(symbol, interval) {
        const alreadySubscribed = this.clientCandleList.some((client) => client.hasCandleSubscription(symbol, interval));
        if (alreadySubscribed) {
            return;
        }
        this.getLastClient('candle').subscribeCandle(symbol, interval);
    }
    unsubscribeCandle(symbol, interval) {
        const client = this.clientCandleList.find((client) => client.hasCandleSubscription(symbol, interval));
        if (!client) {
            return;
        }
        client.unsubscribeCandle(symbol, interval);
    }
    closeConnection() {
        this.clientList.forEach((client) => client.closeConnection());
        this.clientCandleList.forEach((client) => client.closeConnection());
    }
    isSocketOpen() {
        return (this.clientList.every((client) => client.isSocketOpen()) &&
            this.clientCandleList.every((client) => client.isSocketOpen()));
    }
    isSocketConnecting() {
        return (this.clientList.some((client) => client.isSocketConnecting()) ||
            this.clientCandleList.some((client) => client.isSocketConnecting()));
    }
    getSubscriptionNumber() {
        const allClient = [].concat(this.clientList, this.clientCandleList);
        return allClient.reduce((acc, client) => acc + client.getSubscriptionNumber(), 0);
    }
    launchTimerDisconnected() {
        clearInterval(this.timerDisconnectedClient);
        this.timerDisconnectedClient = setInterval(() => this.checkDisconnectedClients(), this.intervalCheckConnection);
        this.timerDisconnectedClient.unref();
    }
    getLastClient(type) {
        const list = type === 'candle' ? this.clientCandleList : this.clientList;
        const lastClient = list[list.length - 1];
        if (!lastClient || lastClient.getSubscriptionNumber() >= this.maxSubscriptions) {
            const newClient = new client_1.Client(this, () => this.emitSubscriptions());
            this.launchTimerDisconnected();
            list.push(newClient);
            newClient.connect();
            return newClient;
        }
        return lastClient;
    }
    emitSubscriptions() {
        const allClient = [].concat(this.clientList, this.clientCandleList);
        const allSubscriptions = allClient.reduce((acc, client) => acc.concat(client.getSubscriptions()), []);
        this.emit(this.subscriptionsEvent, allSubscriptions);
    }
    checkDisconnectedClients() {
        const allClient = [].concat(this.clientList, this.clientCandleList);
        for (const client of allClient) {
            if (!client.receivedPongRecently()) {
                client.forceCloseConnection();
                continue;
            }
            client.shouldReconnectDeadSockets();
        }
    }
}
exports.FtxWS = FtxWS;
//# sourceMappingURL=index.js.map