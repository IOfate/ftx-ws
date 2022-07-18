"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CandleEmulator = void 0;
const parse_duration_1 = __importDefault(require("parse-duration"));
const dayjs_1 = __importDefault(require("dayjs"));
class CandleEmulator {
    constructor(symbol, interval, globalEmitter) {
        this.symbol = symbol;
        this.interval = interval;
        this.globalEmitter = globalEmitter;
        this.gapBetweenCandleTrigger = 500;
        this.intervalMs = (0, parse_duration_1.default)(interval);
        this.resetCurrentCandle();
    }
    launch() {
        this.globalEmitter.on(`ticker-${this.symbol}`, (ticker) => {
            this.processNextTicker(ticker);
        });
    }
    processNextTicker(ticker) {
        const todayMs = (0, dayjs_1.default)().startOf('day').valueOf();
        const startNextCandle = this.getNextCandle(todayMs, ticker.timestamp);
        const currentCandle = startNextCandle - this.intervalMs;
        const currentCandleMax = currentCandle + this.gapBetweenCandleTrigger;
        const inStartCurrentCandle = ticker.timestamp >= currentCandle && ticker.timestamp < currentCandleMax;
        const lastTickMin = startNextCandle - this.gapBetweenCandleTrigger;
        const lastTickMax = startNextCandle + this.gapBetweenCandleTrigger;
        const inLastTickCandle = ticker.timestamp >= lastTickMin && ticker.timestamp <= lastTickMax;
        if (inStartCurrentCandle) {
            this.resetCurrentCandle();
            this.updateCurrentCandle(ticker);
            return;
        }
        if (ticker.timestamp > currentCandleMax &&
            ticker.timestamp < lastTickMin &&
            this.currentCandle.open) {
            this.updateCurrentCandle(ticker);
            return;
        }
        if (inLastTickCandle && this.currentCandle.open) {
            this.updateCurrentCandle(ticker);
            this.globalEmitter.emit(`candle-${this.symbol}-${this.interval}`, this.currentCandle);
            this.resetCurrentCandle();
        }
    }
    getNextCandle(todayMs, tickerMs) {
        let firstTick = todayMs;
        while (firstTick < tickerMs) {
            firstTick += this.intervalMs;
        }
        return firstTick;
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
    updateCurrentCandle(ticker) {
        this.currentCandle.high = Math.max(ticker.high, this.currentCandle.high);
        this.currentCandle.low = !this.currentCandle.low
            ? ticker.low
            : Math.min(ticker.low, this.currentCandle.low);
        if (!this.currentCandle.open) {
            this.currentCandle.open = ticker.last;
        }
        this.currentCandle.close = ticker.last;
        this.currentCandle.timestamp = ticker.timestamp;
    }
}
exports.CandleEmulator = CandleEmulator;
//# sourceMappingURL=candle-emulator.js.map