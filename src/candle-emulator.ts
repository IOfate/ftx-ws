import Emittery from 'emittery';
import parseDuration from 'parse-duration';
import axios from 'axios';

/** Models */
import { Candle } from './models/candle';
import { FtxResponse } from './models/ftx-response.model';
import { CandleApi } from './models/candle-api.model';
import { Trade } from './models/trade';

export class CandleEmulator {
  private readonly ftxApiUrl = 'https://ftx.com/api';
  private readonly intervalMs: number;
  private currentCandle: Candle;
  private unSubFn: Emittery.UnsubscribeFn;
  private timestampDivider: number;

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

    this.unSubFn = this.internalEmitter.on(`trades-${this.symbol}`, (tradeList: Trade[]) => {
      this.processNextTrades(tradeList);
    });
  }

  reset() {
    this.unSubFn();
  }

  private processNextTrades(tradeList: Trade[]) {
    tradeList.forEach((trade: Trade) => {
      const previousCpt = this.timestampDivider;
      this.timestampDivider = Math.trunc(trade.timestamp / this.intervalMs);

      if (this.timestampDivider !== previousCpt) {
        this.globalEmitter.emit(`candle-${this.symbol}-${this.interval}`, this.currentCandle);
        this.resetCurrentCandle();
      }

      this.updateCurrentCandle(trade);
    });
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

  private updateCurrentCandle(trade: Trade) {
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
