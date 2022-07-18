import Emittery from 'emittery';
import WebSocket from 'ws';
import queue from 'queue';
import parseDuration from 'parse-duration';

/** Models */
import { Subscription } from './models/subscription.model';
import { TickerSubscription } from './models/ticker-subscription.model';
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
  private readonly emitChannel = {
    ERROR: 'error',
    RECONNECT: 'reconnect',
    SOCKET_NOT_READY: 'socket-not-ready',
    SUBSCRIPTIONS: 'subscriptions',
    RETRY_SUBSCRIPTION: 'retry-subscription',
  };
  private ws: WebSocket;
  private socketOpen: boolean;
  private socketConnecting: boolean;
  private askingClose: boolean;
  private pingIntervalMs: number;
  private pingTimer: NodeJS.Timer;
  private subscriptions: Subscription[] = [];
  private eventHandler: EventHandler;
  private internalEventHandler: EventHandler;
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
    this.eventHandler = new EventHandler(emitter);
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

  subscribeCandle(symbol: string, interval: string): void {
    if (!candleIntervalList.includes(interval)) {
      throw new TypeError(`Wrong format waiting for: ${candleIntervalList.join(', ')}`);
    }

    if (this.hasCandleSubscription(symbol, interval)) {
      return;
    }

    const formatSymbol = symbol.replace('-', '/');
    const candleEmulator = new CandleEmulator(formatSymbol, interval, this.emitter);

    candleEmulator.launch();

    this.subscribeTicker(symbol);
    this.addCandleSubscription(formatSymbol, interval, candleEmulator);
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
  }

  hasTickerSubscription(symbol: string): boolean {
    return this.subscriptions
      .filter((fSub: Subscription) => fSub.type === 'ticker')
      .some((sSub: TickerSubscription) => sSub.symbol === symbol);
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
      .map((mSub: TickerSubscription) => mSub.symbol);

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

  private addTickerSubscription(symbol: string): void {
    const subscription: TickerSubscription = {
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
