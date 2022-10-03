import Emittery from 'emittery';

/** Root */
import { noop } from './util';

/** Models */
import { MessageData } from './models/message-data.model';
import { RawTicker } from './models/raw-ticker';
import { Ticker } from './models/ticker';
import { RawTrade } from './models/raw-trade';
import { Trade } from './models/trade';

export class EventHandler {
  private readonly maxWaiting = 1500;
  private lastTickers: { [pair: string]: Ticker };
  private lastTrades: { [pair: string]: Trade };
  private mapResolveWaitEvent: { [eventKey: string]: () => void } = {};

  constructor(
    private readonly globalEmitter: Emittery,
    private readonly internalEmitter: Emittery,
  ) {
    this.mapResolveWaitEvent = {};
    this.lastTickers = {};
    this.lastTrades = {};
  }

  waitForEvent(id: string, callback: (result: boolean) => void = noop()): Promise<boolean> {
    return new Promise((resolve) => {
      const cb = (result: boolean) => {
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

  processMessage(message: string): void {
    const received = JSON.parse(message) as MessageData;
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
      this.processRawTicker(received.market, received.data as RawTicker);
    }

    if (received.channel === 'trades') {
      this.processRawTrades(received.market, received.data as RawTrade[]);
    }
  }

  deleteTickerCache(id: string): void {
    delete this.lastTickers[id];
  }

  clearCache(): void {
    this.lastTickers = {};
    this.lastTrades = {};
  }

  getLastTickers(): { [pair: string]: Ticker } {
    return this.lastTickers;
  }

  getLastTrades(): { [pair: string]: Trade } {
    return this.lastTrades;
  }

  private getReceivedEventKey(received: MessageData): string {
    if (received.channel && received.market) {
      return `${received.type}-${received.channel}-${received.market}`;
    }

    return received.type;
  }

  private processRawTicker(symbol: string, rawTicker: RawTicker) {
    const ts = rawTicker.time * 1000;
    const tsInteger = Number.parseInt(ts.toString());
    const ticker: Ticker = {
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

  private processRawTrades(symbol: string, rawTradeList: RawTrade[]) {
    const tradeList: Trade[] = rawTradeList.map((rawTrade: RawTrade) => ({
      ...rawTrade,
      symbol,
      info: rawTrade,
      timestamp: new Date(rawTrade.time).getTime(),
    }));

    this.lastTrades[symbol] = tradeList[tradeList.length - 1];
    this.globalEmitter.emit(`trades-${symbol}`, tradeList);
    this.internalEmitter.emit(`trades-${symbol}`, tradeList);
  }
}
