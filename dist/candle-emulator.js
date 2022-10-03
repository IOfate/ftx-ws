"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CandleEmulator = void 0;
const parse_duration_1 = __importDefault(require("parse-duration"));
const axios_1 = __importDefault(require("axios"));
class CandleEmulator {
    constructor(symbol, interval, globalEmitter, internalEmitter) {
        this.symbol = symbol;
        this.interval = interval;
        this.globalEmitter = globalEmitter;
        this.internalEmitter = internalEmitter;
        this.ftxApiUrl = 'https://ftx.com/api';
        this.intervalMs = (0, parse_duration_1.default)(interval);
        this.resetCurrentCandle();
    }
    async launch() {
        const fetchCurrentCandle = await this.getCurrentCandleFromApi();
        if (fetchCurrentCandle) {
            this.currentCandle = fetchCurrentCandle;
        }
        this.unSubFn = this.internalEmitter.on(`trades-${this.symbol}`, (tradeList) => {
            this.processNextTrades(tradeList);
        });
    }
    reset() {
        this.unSubFn();
    }
    processNextTrades(tradeList) {
        tradeList.forEach((trade) => {
            const previousCpt = this.timestampDivider;
            this.timestampDivider = Math.trunc(trade.timestamp / this.intervalMs);
            if (this.timestampDivider !== previousCpt) {
                this.globalEmitter.emit(`candle-${this.symbol}-${this.interval}`, this.currentCandle);
                this.resetCurrentCandle();
            }
            this.updateCurrentCandle(trade);
        });
    }
    resetCurrentCandle() {
        this.currentCandle = {
            high: 0,
            low: 0,
            open: 0,
            close: 0,
            symbol: this.symbol,
            timestamp: Date.now(),
        };
    }
    updateCurrentCandle(trade) {
        this.currentCandle.high = Math.max(trade.price, this.currentCandle.high);
        this.currentCandle.low = !this.currentCandle.low
            ? trade.price
            : Math.min(trade.price, this.currentCandle.low);
        if (!this.currentCandle.open) {
            this.currentCandle.open = trade.price;
        }
        this.currentCandle.close = trade.price;
        this.currentCandle.timestamp = trade.timestamp;
    }
    async getCurrentCandleFromApi() {
        const intervalSecond = (0, parse_duration_1.default)(this.interval, 'second');
        const symbol = encodeURIComponent(this.symbol);
        const url = `${this.ftxApiUrl}/markets/${symbol}/candles?resolution=${intervalSecond}`;
        try {
            const response = await axios_1.default.get(url);
            const lastCandle = response.data.result.pop();
            return {
                high: lastCandle.high,
                low: lastCandle.low,
                open: lastCandle.open,
                close: lastCandle.close,
                symbol: this.symbol,
                timestamp: Number.parseInt(lastCandle.time.toString(), 10),
            };
        }
        catch (e) {
            return null;
        }
    }
}
exports.CandleEmulator = CandleEmulator;
//# sourceMappingURL=candle-emulator.js.map