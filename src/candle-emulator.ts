import Emittery from 'emittery';
import parseDuration from 'parse-duration';
import dayjs from 'dayjs';
import axios from 'axios';

/** Models */
import { Ticker } from './models/ticker';
import { Candle } from './models/candle';
import { FtxResponse } from './models/ftx-response.model';
import { CandleApi } from './models/candle-api.model';

export class CandleEmulator {
  private readonly ftxApiUrl = 'https://ftx.com/api';
  private readonly gapBetweenCandleTrigger = 500;
  private readonly intervalMs: number;
  private currentCandle: Candle;
  private unSubFn: Emittery.UnsubscribeFn;

  constructor(
    private readonly symbol: string,
    private readonly interval: string,
    private readonly globalEmitter: Emittery,
    private readonly internalEmitter: Emittery,
  ) {
    this.intervalMs = parseDuration(interval);
    this.resetCurrentCandle();
  }

  async launch() {
    const fetchCurrentCandle = await this.getCurrentCandleFromApi();

    if (fetchCurrentCandle) {
      this.currentCandle = fetchCurrentCandle;
    }

    this.unSubFn = this.internalEmitter.on(`ticker-${this.symbol}`, (ticker: Ticker) => {
      this.processNextTicker(ticker);
    });
  }

  reset() {
    this.unSubFn();
  }

  private processNextTicker(ticker: Ticker) {
    const todayMs = dayjs().startOf('day').valueOf();
    const startNextCandle = this.getNextCandle(todayMs, ticker.timestamp);
    const currentCandle = startNextCandle - this.intervalMs;
    const currentCandleMax = currentCandle + this.gapBetweenCandleTrigger;
    const inStartCurrentCandle =
      ticker.timestamp >= currentCandle && ticker.timestamp < currentCandleMax;
    const lastTickMin = startNextCandle - this.gapBetweenCandleTrigger;
    const lastTickMax = startNextCandle + this.gapBetweenCandleTrigger;
    const inLastTickCandle = ticker.timestamp >= lastTickMin && ticker.timestamp <= lastTickMax;

    if (inStartCurrentCandle) {
      this.resetCurrentCandle();
      this.updateCurrentCandle(ticker);

      return;
    }

    if (
      ticker.timestamp > currentCandleMax &&
      ticker.timestamp < lastTickMin &&
      this.currentCandle.open
    ) {
      this.updateCurrentCandle(ticker);

      return;
    }

    if (inLastTickCandle && this.currentCandle.open) {
      this.updateCurrentCandle(ticker);
      this.globalEmitter.emit(`candle-${this.symbol}-${this.interval}`, this.currentCandle);
      this.resetCurrentCandle();
    }
  }

  private getNextCandle(todayMs: number, tickerMs: number): number {
    let firstTick = todayMs;

    while (firstTick < tickerMs) {
      firstTick += this.intervalMs;
    }

    return firstTick;
  }

  private resetCurrentCandle() {
    this.currentCandle = {
      high: 0,
      low: 0,
      open: 0,
      close: 0,
      symbol: this.symbol,
      timestamp: Date.now(),
    };
  }

  private updateCurrentCandle(ticker: Ticker) {
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

  private async getCurrentCandleFromApi(): Promise<Candle | null> {
    const intervalSecond = parseDuration(this.interval, 'second');
    const symbol = encodeURIComponent(this.symbol);
    const url = `${this.ftxApiUrl}/markets/${symbol}/candles?resolution=${intervalSecond}`;

    try {
      const response = await axios.get<FtxResponse<CandleApi[]>>(url);
      const lastCandle = response.data.result.pop();

      return {
        high: lastCandle.high,
        low: lastCandle.low,
        open: lastCandle.open,
        close: lastCandle.close,
        symbol: this.symbol,
        timestamp: Number.parseInt(lastCandle.time.toString(), 10),
      } as Candle;
    } catch (e) {
      return null;
    }
  }
}
