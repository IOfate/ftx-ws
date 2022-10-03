import Emittery from 'emittery';
import WebSocket from 'ws';
import queue from 'queue';
import parseDuration from 'parse-duration';

/** Models */
import { Subscription } from './models/subscription.model';
import { TradesSubscription } from './models/trades-subscription.model';
import { CandleSubscription } from './models/candle-subscription.model';

/** Root */
import { delay, noop } from './util';
import { EventHandler } from './event-handler';
import { candleIntervalList } from './const';
import { CandleEmulator } from './candle-emulator';

export class Client {
  private readonly queueProcessor = queue({ concurrency: 1, timeout: 250, autostart: true });
  private readonly retryTimeoutMs = parseDuration('5s');
  private readonly retrySubscription = parseDuration('2s');
  private readonly triggerTickerDisconnected = parseDuration('6m');
  private readonly wsPath = 'wss://ftx.com/ws/';
  private readonly internalEmitter: Emittery;
  private readonly emitChannel = {
    ERROR: 'error',
    RECONNECT: 'reconnect',
    SOCKET_NOT_READY: 'socket-not-ready',
    SUBSCRIPTIONS: 'subscriptions',
    RETRY_SUBSCRIPTION: 'retry-subscription',
    RECONNECT_CANDLE: 'reconnect-candle',
  };
  private ws: WebSocket;
  private socketOpen: boolean;
  private socketConnecting: boolean;
  private askingClose: boolean;
  private pingIntervalMs: number;
  private pingTimer: NodeJS.Timer;
  private subscriptions: Subscription[] = [];
  private eventHandler: EventHandler;
  private disconnectedTrigger: number;
  private lastPongReceived: number | undefined;
  private mapRetrySubscription: { [key: string]: NodeJS.Timer };

  constructor(
    private readonly emitter: Emittery,
    private readonly globalEmitSubscription: () => void,
  ) {
    this.socketOpen = false;
    this.askingClose = false;
    this.mapRetrySubscription = {};
    this.internalEmitter = new Emittery();
    this.eventHandler = new EventHandler(emitter, this.internalEmitter);
  }

  async connect(): Promise<void> {
    this.lastPongReceived = Date.now();
    this.socketConnecting = true;

    this.askingClose = false;
    this.eventHandler.clearCache();
    this.pingIntervalMs = parseDuration('15s');
    this.disconnectedTrigger = this.pingIntervalMs * 2;

    await this.openWebsocketConnection();

    this.lastPongReceived = Date.now();

    if (this.subscriptions.length) {
      Object.keys(this.mapRetrySubscription).forEach((keySub: string) => clearInterval(keySub));

      this.restartPreviousSubscriptions();
    }
  }

  subscribeTicker(symbol: string): void {
    const formatSymbol = symbol.replace('-', '/');

    if (this.hasTickerSubscription(symbol)) {
      return;
    }

    const keySub = `subscribed-ticker-${formatSymbol}`;

    clearInterval(this.mapRetrySubscription[keySub]);

    this.addTickerSubscription(symbol);
    const sub = () => {
      if (!this.isSocketOpen()) {
        const timerRetry = setTimeout(() => sub(), this.retrySubscription).unref();
        this.mapRetrySubscription[keySub] = timerRetry;

        return;
      }

      if (!this.ws.readyState) {
        this.emitter.emit(
          this.emitChannel.SOCKET_NOT_READY,
          `socket not ready to subscribe ticker for: ${symbol}, retrying in ${this.retryTimeoutMs}ms`,
        );
        const timerRetry = setTimeout(() => sub(), this.retryTimeoutMs).unref();
        this.mapRetrySubscription[keySub] = timerRetry;

        return;
      }

      this.queueProcessor.push(() => {
        this.eventHandler.waitForEvent(keySub, (result: boolean) => {
          if (result) {
            return;
          }

          this.removeTickerSubscription(symbol);
          setTimeout(() => {
            this.emitter.emit(
              this.emitChannel.RETRY_SUBSCRIPTION,
              `retry to subscribe ticker for: ${symbol}, retrying in ${this.retrySubscription}ms`,
            );
            this.subscribeTicker(symbol);
          }, this.retrySubscription).unref();
        });

        this.send(
          JSON.stringify({
            op: 'subscribe',
            channel: 'ticker',
            market: formatSymbol,
          }),
          (error?: Error) => {
            if (error) {
              this.emitter.emit(this.emitChannel.ERROR, error);
              setTimeout(() => {
                this.emitter.emit(
                  this.emitChannel.RETRY_SUBSCRIPTION,
                  `retry to subscribe ticker for: ${symbol}, retrying in ${this.retrySubscription}ms`,
                );
                this.subscribeTicker(symbol);
              }, this.retrySubscription).unref();

              return this.removeTickerSubscription(symbol);
            }
          },
        );
      });
    };

    sub();
  }

  unsubscribeTicker(symbol: string): void {
    this.requireSocketToBeOpen();
    const formatSymbol = symbol.replace('-', '/');

    if (!this.hasTickerSubscription(symbol)) {
      return;
    }

    this.removeTickerSubscription(symbol);
    this.queueProcessor.push(() => {
      this.eventHandler.waitForEvent(`unsubscribed-ticker-${formatSymbol}`, (result: boolean) => {
        if (result) {
          this.eventHandler.deleteTickerCache(formatSymbol);

          return;
        }

        this.addTickerSubscription(symbol);
      });

      this.send(
        JSON.stringify({
          op: 'unsubscribe',
          channel: 'ticker',
          market: formatSymbol,
        }),
        (error?: Error) => {
          if (error) {
            this.emitter.emit(this.emitChannel.ERROR, error);

            return this.addTickerSubscription(symbol);
          }
        },
      );
    });
  }

  subscribeTrades(symbol: string, forCandle = false): void {
    const formatSymbol = symbol.replace('-', '/');

    if (this.hasTradesSubscription(symbol)) {
      return;
    }

    const keySub = `subscribed-trades-${formatSymbol}`;

    clearInterval(this.mapRetrySubscription[keySub]);

    this.addTradesSubscription(symbol, forCandle);
    const sub = () => {
      if (!this.isSocketOpen()) {
        const timerRetry = setTimeout(() => sub(), this.retrySubscription).unref();
        this.mapRetrySubscription[keySub] = timerRetry;

        return;
      }

      if (!this.ws.readyState) {
        this.emitter.emit(
          this.emitChannel.SOCKET_NOT_READY,
          `socket not ready to subscribe trades for: ${symbol}, retrying in ${this.retryTimeoutMs}ms`,
        );
        const timerRetry = setTimeout(() => sub(), this.retryTimeoutMs).unref();
        this.mapRetrySubscription[keySub] = timerRetry;

        return;
      }

      this.queueProcessor.push(() => {
        this.eventHandler.waitForEvent(keySub, (result: boolean) => {
          if (result) {
            return;
          }

          this.removeTradesSubscription(symbol);
          setTimeout(() => {
            this.emitter.emit(
              this.emitChannel.RETRY_SUBSCRIPTION,
              `retry to subscribe trades for: ${symbol}, retrying in ${this.retrySubscription}ms`,
            );
            this.subscribeTrades(symbol);
          }, this.retrySubscription).unref();
        });

        this.send(
          JSON.stringify({
            op: 'subscribe',
            channel: 'trades',
            market: formatSymbol,
          }),
          (error?: Error) => {
            if (error) {
              this.emitter.emit(this.emitChannel.ERROR, error);
              setTimeout(() => {
                this.emitter.emit(
                  this.emitChannel.RETRY_SUBSCRIPTION,
                  `retry to subscribe trades for: ${symbol}, retrying in ${this.retrySubscription}ms`,
                );
                this.subscribeTrades(symbol);
              }, this.retrySubscription).unref();

              return this.removeTradesSubscription(symbol);
            }
          },
        );
      });
    };

    sub();
  }

  unsubscribeTrades(symbol: string): void {
    this.requireSocketToBeOpen();
    const formatSymbol = symbol.replace('-', '/');

    if (!this.hasTradesSubscription(symbol)) {
      return;
    }

    const tradesSub = this.subscriptions.find(
      (fSub: TradesSubscription) => fSub.type === 'trades' && fSub.symbol === symbol,
    );
    this.removeTradesSubscription(symbol);
    this.queueProcessor.push(() => {
      this.eventHandler.waitForEvent(`unsubscribed-trades-${formatSymbol}`, (result: boolean) => {
        if (result) {
          return;
        }

        this.addTradesSubscription(symbol, (tradesSub as TradesSubscription).forCandle);
      });

      this.send(
        JSON.stringify({
          op: 'unsubscribe',
          channel: 'trades',
          market: formatSymbol,
        }),
        (error?: Error) => {
          if (error) {
            this.emitter.emit(this.emitChannel.ERROR, error);

            return this.addTradesSubscription(symbol, (tradesSub as TradesSubscription).forCandle);
          }
        },
      );
    });
  }

  subscribeCandle(symbol: string, interval: string): void {
    if (!candleIntervalList.includes(interval)) {
      throw new TypeError(`Wrong format waiting for: ${candleIntervalList.join(', ')}`);
    }

    if (this.hasCandleSubscription(symbol, interval)) {
      return;
    }

    const formatSymbol = symbol.replace('-', '/');
    const candleEmulator = new CandleEmulator(
      formatSymbol,
      interval,
      this.emitter,
      this.internalEmitter,
    );

    candleEmulator.launch();

    this.subscribeTrades(symbol, true);
    this.addCandleSubscription(formatSymbol, interval, candleEmulator);
  }

  unsubscribeCandle(symbol: string, interval: string): void {
    const formatSymbol = symbol.replace('-', '/');

    if (!this.hasCandleSubscription(formatSymbol, interval)) {
      return;
    }

    const candleSubscription = this.subscriptions.find(
      (fSub: CandleSubscription) =>
        fSub.type === 'candle' && fSub.symbol === symbol && fSub.interval === interval,
    ) as CandleSubscription;

    candleSubscription.emulator.reset();
    this.removeCandleSubscription(formatSymbol, interval);

    const sameTickerSocket = this.subscriptions.filter(
      (fSub: Subscription) => fSub.type === 'candle' && fSub.symbol === formatSymbol,
    ).length;

    if (sameTickerSocket === 1) {
      this.unsubscribeTicker(formatSymbol);
    }
  }

  closeConnection(): void {
    if (this.subscriptions.length) {
      throw new Error(`You have activated subscriptions! (${this.subscriptions.length})`);
    }

    this.askingClose = true;
    this.ws.close();
  }

  forceCloseConnection(): void {
    if (!this.isSocketOpen()) {
      return;
    }

    this.ws.close();
  }

  isSocketOpen(): boolean {
    return !!this.ws && this.socketOpen;
  }

  isSocketConnecting(): boolean {
    return this.socketConnecting;
  }

  getSubscriptionNumber(): number {
    return this.subscriptions.length;
  }

  getSubscriptions(): Subscription[] {
    return this.subscriptions;
  }

  receivedPongRecently(): boolean {
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
    this.shouldReconnectTrades(now);
  }

  hasTickerSubscription(symbol: string): boolean {
    return this.subscriptions
      .filter((fSub: Subscription) => fSub.type === 'ticker')
      .some((sSub: Subscription) => sSub.symbol === symbol);
  }

  hasTradesSubscription(symbol: string): boolean {
    return this.subscriptions
      .filter((fSub: Subscription) => fSub.type === 'trades')
      .some((sSub: TradesSubscription) => sSub.symbol === symbol);
  }

  hasCandleSubscription(symbol: string, interval: string): boolean {
    return this.subscriptions
      .filter((fSub: Subscription) => fSub.type === 'candle')
      .some((sSub: CandleSubscription) => sSub.symbol === symbol && sSub.interval === interval);
  }

  private shouldReconnectTickers(now: number) {
    const lastEmittedTickers = this.eventHandler.getLastTickers();
    const allTickers = this.subscriptions
      .filter((fSub: Subscription) => fSub.type === 'ticker')
      .map((mSub: Subscription) => mSub.symbol);

    allTickers
      .filter((pair: string) => {
        if (!lastEmittedTickers[pair]) {
          return true;
        }

        const timeDiff = now - lastEmittedTickers[pair].timestamp;

        return timeDiff >= this.triggerTickerDisconnected;
      })
      .forEach((pair: string) => {
        this.unsubscribeTicker(pair);
        this.subscribeTicker(pair);
      });
  }

  private shouldReconnectTrades(now: number) {
    const lastEmittedTrades = this.eventHandler.getLastTrades();
    const allTrades = this.subscriptions
      .filter((fSub: Subscription) => fSub.type === 'trades')
      .map((mSub: TradesSubscription) => mSub.symbol);

    allTrades
      .filter((pair: string) => {
        if (!lastEmittedTrades[pair]) {
          return true;
        }

        const timeDiff = now - lastEmittedTrades[pair].timestamp;

        return timeDiff >= this.triggerTickerDisconnected;
      })
      .forEach((pair: string) => {
        const tradesSubs = this.subscriptions.find(
          (fSub: TradesSubscription) => fSub.type === 'trades' && fSub.symbol === pair,
        ) as TradesSubscription;
        this.unsubscribeTrades(pair);
        this.subscribeTrades(pair, tradesSubs.forCandle);

        if (tradesSubs.forCandle) {
          const candleSubList = this.subscriptions.filter(
            (fSub: Subscription) => fSub.type === 'candle' && fSub.symbol === pair,
          ) as CandleSubscription[];

          candleSubList.forEach((candleSub: CandleSubscription) => {
            this.emitter.emit(this.emitChannel.RECONNECT_CANDLE, candleSub);
          });
        }
      });
  }

  private addTickerSubscription(symbol: string): void {
    const subscription: Subscription = {
      symbol,
      type: 'ticker',
      timestamp: Date.now(),
    };

    this.subscriptions.push(subscription);
    this.globalEmitSubscription();
  }

  private removeTickerSubscription(symbol: string): void {
    if (!this.hasTickerSubscription(symbol)) {
      return;
    }

    const indexSub = this.subscriptions.findIndex(
      (fSub: Subscription) => fSub.type === 'ticker' && fSub.symbol === symbol,
    );

    this.subscriptions.splice(indexSub, 1);
    this.globalEmitSubscription();
  }

  private addTradesSubscription(symbol: string, forCandle: boolean): void {
    const subscription: TradesSubscription = {
      symbol,
      forCandle,
      type: 'trades',
      timestamp: Date.now(),
    };

    this.subscriptions.push(subscription);
    this.globalEmitSubscription();
  }

  private removeTradesSubscription(symbol: string): void {
    if (!this.hasTradesSubscription(symbol)) {
      return;
    }

    const indexSub = this.subscriptions.findIndex(
      (fSub: Subscription) => fSub.type === 'trades' && fSub.symbol === symbol,
    );

    this.subscriptions.splice(indexSub, 1);
    this.globalEmitSubscription();
  }

  private addCandleSubscription(symbol: string, interval: string, emulator: CandleEmulator): void {
    const subscription: CandleSubscription = {
      symbol,
      interval,
      emulator,
      type: 'candle',
      timestamp: Date.now(),
    };

    this.subscriptions.push(subscription);
    this.globalEmitSubscription();
  }

  private removeCandleSubscription(symbol: string, interval: string): void {
    if (!this.hasCandleSubscription(symbol, interval)) {
      return;
    }

    const indexSub = this.subscriptions
      .filter((fSub: Subscription) => fSub.type === 'candle')
      .findIndex(
        (fSub: CandleSubscription) => fSub.symbol === symbol && fSub.interval === interval,
      );

    this.subscriptions.splice(indexSub, 1);
    this.globalEmitSubscription();
  }

  private send(data: string, sendCb = noop()) {
    if (!this.ws) {
      return;
    }

    this.ws.send(data, sendCb);
  }

  private restartPreviousSubscriptions() {
    if (!this.socketOpen) {
      return;
    }

    if (!this.ws.readyState) {
      this.emitter.emit(
        this.emitChannel.SOCKET_NOT_READY,
        'retry later to restart previous subscriptions',
      );
      setTimeout(() => this.restartPreviousSubscriptions(), this.retryTimeoutMs).unref();

      return;
    }

    const previousSubs: Subscription[] = [].concat(this.subscriptions);
    this.subscriptions.length = 0;

    for (const subscription of previousSubs) {
      if (subscription.type === 'ticker') {
        this.subscribeTicker(subscription.symbol);
      }

      if (subscription.type === 'trades' && !(subscription as TradesSubscription).forCandle) {
        this.subscribeTrades(subscription.symbol);
      }

      if (subscription.type === 'candle') {
        (subscription as CandleSubscription).emulator.reset();
        this.subscribeCandle(subscription.symbol, (subscription as CandleSubscription).interval);
      }
    }
  }

  private requireSocketToBeOpen(): void {
    if (!this.isSocketOpen()) {
      throw new Error('Please call connect before subscribing');
    }
  }

  private sendPing() {
    this.requireSocketToBeOpen();

    this.eventHandler.waitForEvent('pong', (result: boolean) => {
      if (result) {
        this.lastPongReceived = Date.now();

        return;
      }
    });

    this.send(
      JSON.stringify({
        op: 'ping',
      }),
    );
  }

  private startPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.sendPing(), this.pingIntervalMs);
  }

  private stopPing() {
    clearInterval(this.pingTimer);
  }

  private async reconnect() {
    await delay(this.retryTimeoutMs);
    this.emitter.emit(
      this.emitChannel.RECONNECT,
      `reconnect with ${this.subscriptions.length} sockets...`,
    );
    this.connect();
  }

  private async openWebsocketConnection(): Promise<void> {
    if (this.socketOpen) {
      return;
    }

    this.queueProcessor.start();
    this.ws = new WebSocket(this.wsPath, {
      perMessageDeflate: false,
      handshakeTimeout: this.retryTimeoutMs,
    });

    this.ws.on('message', (data: string) => {
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

    this.ws.on('error', (ws: WebSocket, error: Error) => {
      this.emitter.emit(this.emitChannel.ERROR, error);
    });

    await this.waitOpenSocket();
    this.startPing();

    this.socketOpen = true;
    this.socketConnecting = false;
  }

  private waitOpenSocket(): Promise<void> {
    return new Promise((resolve) => {
      this.ws.on('open', () => {
        resolve();
      });
    });
  }
}
