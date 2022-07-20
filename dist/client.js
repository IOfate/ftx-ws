"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Client = void 0;
const emittery_1 = __importDefault(require("emittery"));
const ws_1 = __importDefault(require("ws"));
const queue_1 = __importDefault(require("queue"));
const parse_duration_1 = __importDefault(require("parse-duration"));
/** Root */
const util_1 = require("./util");
const event_handler_1 = require("./event-handler");
const const_1 = require("./const");
const candle_emulator_1 = require("./candle-emulator");
class Client {
    constructor(emitter, globalEmitSubscription) {
        this.emitter = emitter;
        this.globalEmitSubscription = globalEmitSubscription;
        this.queueProcessor = (0, queue_1.default)({ concurrency: 1, timeout: 250, autostart: true });
        this.retryTimeoutMs = (0, parse_duration_1.default)('5s');
        this.retrySubscription = (0, parse_duration_1.default)('2s');
        this.triggerTickerDisconnected = (0, parse_duration_1.default)('6m');
        this.wsPath = 'wss://ftx.com/ws/';
        this.emitChannel = {
            ERROR: 'error',
            RECONNECT: 'reconnect',
            SOCKET_NOT_READY: 'socket-not-ready',
            SUBSCRIPTIONS: 'subscriptions',
            RETRY_SUBSCRIPTION: 'retry-subscription',
        };
        this.subscriptions = [];
        this.socketOpen = false;
        this.askingClose = false;
        this.mapRetrySubscription = {};
        this.internalEmitter = new emittery_1.default();
        this.eventHandler = new event_handler_1.EventHandler(emitter, this.internalEmitter);
    }
    async connect() {
        this.lastPongReceived = Date.now();
        this.socketConnecting = true;
        this.askingClose = false;
        this.eventHandler.clearCache();
        this.pingIntervalMs = (0, parse_duration_1.default)('15s');
        this.disconnectedTrigger = this.pingIntervalMs * 2;
        await this.openWebsocketConnection();
        this.lastPongReceived = Date.now();
        if (this.subscriptions.length) {
            Object.keys(this.mapRetrySubscription).forEach((keySub) => clearInterval(keySub));
            this.restartPreviousSubscriptions();
        }
    }
    subscribeTicker(symbol, forCandle = false) {
        const formatSymbol = symbol.replace('-', '/');
        if (this.hasTickerSubscription(symbol)) {
            return;
        }
        const keySub = `subscribed-ticker-${formatSymbol}`;
        clearInterval(this.mapRetrySubscription[keySub]);
        this.addTickerSubscription(symbol, forCandle);
        const sub = () => {
            if (!this.isSocketOpen()) {
                const timerRetry = setTimeout(() => sub(), this.retrySubscription).unref();
                this.mapRetrySubscription[keySub] = timerRetry;
                return;
            }
            if (!this.ws.readyState) {
                this.emitter.emit(this.emitChannel.SOCKET_NOT_READY, `socket not ready to subscribe ticker for: ${symbol}, retrying in ${this.retryTimeoutMs}ms`);
                const timerRetry = setTimeout(() => sub(), this.retryTimeoutMs).unref();
                this.mapRetrySubscription[keySub] = timerRetry;
                return;
            }
            this.queueProcessor.push(() => {
                this.eventHandler.waitForEvent(keySub, (result) => {
                    if (result) {
                        return;
                    }
                    this.removeTickerSubscription(symbol);
                    setTimeout(() => {
                        this.emitter.emit(this.emitChannel.RETRY_SUBSCRIPTION, `retry to subscribe ticker for: ${symbol}, retrying in ${this.retrySubscription}ms`);
                        this.subscribeTicker(symbol);
                    }, this.retrySubscription).unref();
                });
                this.send(JSON.stringify({
                    op: 'subscribe',
                    channel: 'ticker',
                    market: formatSymbol,
                }), (error) => {
                    if (error) {
                        this.emitter.emit(this.emitChannel.ERROR, error);
                        setTimeout(() => {
                            this.emitter.emit(this.emitChannel.RETRY_SUBSCRIPTION, `retry to subscribe ticker for: ${symbol}, retrying in ${this.retrySubscription}ms`);
                            this.subscribeTicker(symbol);
                        }, this.retrySubscription).unref();
                        return this.removeTickerSubscription(symbol);
                    }
                });
            });
        };
        sub();
    }
    unsubscribeTicker(symbol) {
        this.requireSocketToBeOpen();
        const formatSymbol = symbol.replace('-', '/');
        if (!this.hasTickerSubscription(symbol)) {
            return;
        }
        const tickerSubs = this.subscriptions.find((fSub) => fSub.type === 'ticker' && fSub.symbol === symbol);
        this.removeTickerSubscription(symbol);
        this.queueProcessor.push(() => {
            this.eventHandler.waitForEvent(`unsubscribed-ticker-${formatSymbol}`, (result) => {
                if (result) {
                    this.eventHandler.deleteTickerCache(formatSymbol);
                    return;
                }
                this.addTickerSubscription(symbol, tickerSubs.forCandle);
            });
            this.send(JSON.stringify({
                op: 'unsubscribe',
                channel: 'ticker',
                market: formatSymbol,
            }), (error) => {
                if (error) {
                    this.emitter.emit(this.emitChannel.ERROR, error);
                    return this.addTickerSubscription(symbol, tickerSubs.forCandle);
                }
            });
        });
    }
    subscribeCandle(symbol, interval) {
        if (!const_1.candleIntervalList.includes(interval)) {
            throw new TypeError(`Wrong format waiting for: ${const_1.candleIntervalList.join(', ')}`);
        }
        if (this.hasCandleSubscription(symbol, interval)) {
            return;
        }
        const formatSymbol = symbol.replace('-', '/');
        const candleEmulator = new candle_emulator_1.CandleEmulator(formatSymbol, interval, this.emitter, this.internalEmitter);
        candleEmulator.launch();
        this.subscribeTicker(symbol, true);
        this.addCandleSubscription(formatSymbol, interval, candleEmulator);
    }
    unsubscribeCandle(symbol, interval) {
        const formatSymbol = symbol.replace('-', '/');
        if (!this.hasCandleSubscription(formatSymbol, interval)) {
            return;
        }
        const candleSubscription = this.subscriptions.find((fSub) => fSub.type === 'candle' && fSub.symbol === symbol && fSub.interval === interval);
        candleSubscription.emulator.reset();
        this.removeCandleSubscription(formatSymbol, interval);
        const sameTickerSocket = this.subscriptions.filter((fSub) => fSub.type === 'candle' && fSub.symbol === formatSymbol).length;
        if (sameTickerSocket === 1) {
            this.unsubscribeTicker(formatSymbol);
        }
    }
    closeConnection() {
        if (this.subscriptions.length) {
            throw new Error(`You have activated subscriptions! (${this.subscriptions.length})`);
        }
        this.askingClose = true;
        this.ws.close();
    }
    forceCloseConnection() {
        if (!this.isSocketOpen()) {
            return;
        }
        this.ws.close();
    }
    isSocketOpen() {
        return !!this.ws && this.socketOpen;
    }
    isSocketConnecting() {
        return this.socketConnecting;
    }
    getSubscriptionNumber() {
        return this.subscriptions.length;
    }
    getSubscriptions() {
        return this.subscriptions;
    }
    receivedPongRecently() {
        if (!this.lastPongReceived) {
            return false;
        }
        if (this.socketConnecting) {
            return true;
        }
        const timeDiff = Date.now() - this.lastPongReceived;
        return timeDiff < this.disconnectedTrigger;
    }
    shouldReconnectDeadSockets() {
        if (!this.isSocketOpen()) {
            return;
        }
        const now = Date.now();
        this.shouldReconnectTickers(now);
    }
    hasTickerSubscription(symbol) {
        return this.subscriptions
            .filter((fSub) => fSub.type === 'ticker')
            .some((sSub) => sSub.symbol === symbol);
    }
    hasCandleSubscription(symbol, interval) {
        return this.subscriptions
            .filter((fSub) => fSub.type === 'candle')
            .some((sSub) => sSub.symbol === symbol && sSub.interval === interval);
    }
    shouldReconnectTickers(now) {
        const lastEmittedTickers = this.eventHandler.getLastTickers();
        const allTickers = this.subscriptions
            .filter((fSub) => fSub.type === 'ticker')
            .map((mSub) => mSub.symbol);
        allTickers
            .filter((pair) => {
            if (!lastEmittedTickers[pair]) {
                return true;
            }
            const timeDiff = now - lastEmittedTickers[pair].timestamp;
            return timeDiff >= this.triggerTickerDisconnected;
        })
            .forEach((pair) => {
            const tickerSubs = this.subscriptions.find((fSub) => fSub.type === 'ticker' && fSub.symbol === pair);
            this.unsubscribeTicker(pair);
            this.subscribeTicker(pair, tickerSubs.forCandle);
        });
    }
    addTickerSubscription(symbol, forCandle) {
        const subscription = {
            symbol,
            forCandle,
            type: 'ticker',
            timestamp: Date.now(),
        };
        this.subscriptions.push(subscription);
        this.globalEmitSubscription();
    }
    removeTickerSubscription(symbol) {
        if (!this.hasTickerSubscription(symbol)) {
            return;
        }
        const indexSub = this.subscriptions.findIndex((fSub) => fSub.type === 'ticker' && fSub.symbol === symbol);
        this.subscriptions.splice(indexSub, 1);
        this.globalEmitSubscription();
    }
    addCandleSubscription(symbol, interval, emulator) {
        const subscription = {
            symbol,
            interval,
            emulator,
            type: 'candle',
            timestamp: Date.now(),
        };
        this.subscriptions.push(subscription);
        this.globalEmitSubscription();
    }
    removeCandleSubscription(symbol, interval) {
        if (!this.hasCandleSubscription(symbol, interval)) {
            return;
        }
        const indexSub = this.subscriptions
            .filter((fSub) => fSub.type === 'candle')
            .findIndex((fSub) => fSub.symbol === symbol && fSub.interval === interval);
        this.subscriptions.splice(indexSub, 1);
        this.globalEmitSubscription();
    }
    send(data, sendCb = (0, util_1.noop)()) {
        if (!this.ws) {
            return;
        }
        this.ws.send(data, sendCb);
    }
    restartPreviousSubscriptions() {
        if (!this.socketOpen) {
            return;
        }
        if (!this.ws.readyState) {
            this.emitter.emit(this.emitChannel.SOCKET_NOT_READY, 'retry later to restart previous subscriptions');
            setTimeout(() => this.restartPreviousSubscriptions(), this.retryTimeoutMs).unref();
            return;
        }
        const previousSubs = [].concat(this.subscriptions);
        this.subscriptions.length = 0;
        for (const subscription of previousSubs) {
            if (subscription.type === 'ticker' && !subscription.forCandle) {
                this.subscribeTicker(subscription.symbol);
            }
            if (subscription.type === 'candle') {
                subscription.emulator.reset();
                this.subscribeCandle(subscription.symbol, subscription.interval);
            }
        }
    }
    requireSocketToBeOpen() {
        if (!this.isSocketOpen()) {
            throw new Error('Please call connect before subscribing');
        }
    }
    sendPing() {
        this.requireSocketToBeOpen();
        this.eventHandler.waitForEvent('pong', (result) => {
            if (result) {
                this.lastPongReceived = Date.now();
                return;
            }
        });
        this.send(JSON.stringify({
            op: 'ping',
        }));
    }
    startPing() {
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.sendPing(), this.pingIntervalMs);
    }
    stopPing() {
        clearInterval(this.pingTimer);
    }
    async reconnect() {
        await (0, util_1.delay)(this.retryTimeoutMs);
        this.emitter.emit(this.emitChannel.RECONNECT, `reconnect with ${this.subscriptions.length} sockets...`);
        this.connect();
    }
    async openWebsocketConnection() {
        if (this.socketOpen) {
            return;
        }
        this.queueProcessor.start();
        this.ws = new ws_1.default(this.wsPath, {
            perMessageDeflate: false,
            handshakeTimeout: this.retryTimeoutMs,
        });
        this.ws.on('message', (data) => {
            this.eventHandler.processMessage(data);
        });
        this.ws.on('close', () => {
            this.queueProcessor.end();
            this.socketOpen = false;
            this.stopPing();
            this.ws = undefined;
            if (!this.askingClose) {
                this.reconnect();
            }
        });
        this.ws.on('error', (ws, error) => {
            this.emitter.emit(this.emitChannel.ERROR, error);
        });
        await this.waitOpenSocket();
        this.startPing();
        this.socketOpen = true;
        this.socketConnecting = false;
    }
    waitOpenSocket() {
        return new Promise((resolve) => {
            this.ws.on('open', () => {
                resolve();
            });
        });
    }
}
exports.Client = Client;
//# sourceMappingURL=client.js.map