"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventHandler = void 0;
/** Root */
const util_1 = require("./util");
class EventHandler {
    constructor(globalEmitter, internalEmitter) {
        this.globalEmitter = globalEmitter;
        this.internalEmitter = internalEmitter;
        this.maxWaiting = 1500;
        this.mapResolveWaitEvent = {};
        this.mapResolveWaitEvent = {};
        this.lastTickers = {};
    }
    waitForEvent(id, callback = (0, util_1.noop)()) {
        return new Promise((resolve) => {
            const cb = (result) => {
                if (this.mapResolveWaitEvent[id]) {
                    delete this.mapResolveWaitEvent[id];
                    resolve(result);
                    callback(result);
                }
            };
            this.mapResolveWaitEvent[id] = () => cb(true);
            setTimeout(() => cb(false), this.maxWaiting).unref();
        });
    }
    processMessage(message) {
        const received = JSON.parse(message);
        const eventKey = this.getReceivedEventKey(received);
        if (this.mapResolveWaitEvent[eventKey]) {
            this.mapResolveWaitEvent[eventKey]();
            return;
        }
        if (received.type === 'error') {
            const error = new Error(received.msg);
            this.globalEmitter.emit('error', error);
        }
        if (received.type === 'update' && received.channel === 'ticker') {
            this.processRawTicker(received.market, received.data);
        }
    }
    deleteTickerCache(id) {
        delete this.lastTickers[id];
    }
    clearCache() {
        this.lastTickers = {};
    }
    getLastTickers() {
        return this.lastTickers;
    }
    getReceivedEventKey(received) {
        if (received.channel && received.market) {
            return `${received.type}-${received.channel}-${received.market}`;
        }
        return received.type;
    }
    processRawTicker(symbol, rawTicker) {
        const ts = rawTicker.time * 1000;
        const tsInteger = Number.parseInt(ts.toString());
        const ticker = {
            symbol,
            info: rawTicker,
            timestamp: tsInteger,
            datetime: new Date(tsInteger).toUTCString(),
            high: rawTicker.ask,
            low: rawTicker.bid,
            ask: rawTicker.ask,
            bid: rawTicker.bid,
            last: rawTicker.last,
            close: rawTicker.last,
        };
        this.lastTickers[symbol] = ticker;
        this.globalEmitter.emit(`ticker-${symbol}`, ticker);
        this.internalEmitter.emit(`ticker-${symbol}`, ticker);
    }
}
exports.EventHandler = EventHandler;
//# sourceMappingURL=event-handler.js.map