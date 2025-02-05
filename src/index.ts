import Emittery from 'emittery';
import parseDuration from 'parse-duration';

/** Root */
import { Client } from './client';

/** Models */
import { Subscription } from './models/subscription.model';

export class FtxWS extends Emittery {
  private readonly clientList: Client[] = [];
  private readonly clientCandleList: Client[] = [];
  private readonly maxSubscriptions = 98;
  private readonly subscriptionsEvent = 'subscriptions';
  private readonly intervalCheckConnection = parseDuration('32s');
  private timerDisconnectedClient: NodeJS.Timer;

  constructor() {
    super();

    this.launchTimerDisconnected();
  }

  subscribeTicker(symbol: string): void {
    const alreadySubscribed = this.clientList.some((client: Client) =>
      client.hasTickerSubscription(symbol),
    );

    if (alreadySubscribed) {
      return;
    }

    this.getLastClient('ticker').subscribeTicker(symbol);
  }

  subscribeTickers(symbols: string[]): void {
    symbols.forEach((symbol: string) => this.subscribeTicker(symbol));
  }

  unsubscribeTicker(symbol: string): void {
    const client = this.clientList.find((client: Client) => client.hasTickerSubscription(symbol));

    if (!client) {
      return;
    }

    client.unsubscribeTicker(symbol);
  }

  unsubscribeTickers(symbols: string[]): void {
    symbols.forEach((symbol: string) => this.unsubscribeTicker(symbol));
  }

  subscribeTrades(symbol: string): void {
    const alreadySubscribed = this.clientList.some((client: Client) =>
      client.hasTradesSubscription(symbol),
    );

    if (alreadySubscribed) {
      return;
    }

    this.getLastClient('trades').subscribeTrades(symbol);
  }

  unsubscribeTrades(symbol: string): void {
    const client = this.clientList.find((client: Client) => client.hasTradesSubscription(symbol));

    if (!client) {
      return;
    }

    client.unsubscribeTrades(symbol);
  }

  subscribeCandle(symbol: string, interval: string): void {
    const alreadySubscribed = this.clientCandleList.some((client: Client) =>
      client.hasCandleSubscription(symbol, interval),
    );

    if (alreadySubscribed) {
      return;
    }

    this.getLastClient('candle').subscribeCandle(symbol, interval);
  }

  unsubscribeCandle(symbol: string, interval: string): void {
    const client = this.clientCandleList.find((client: Client) =>
      client.hasCandleSubscription(symbol, interval),
    );

    if (!client) {
      return;
    }

    client.unsubscribeCandle(symbol, interval);
  }

  closeConnection(): void {
    this.clientList.forEach((client: Client) => client.closeConnection());
    this.clientCandleList.forEach((client: Client) => client.closeConnection());
  }

  isSocketOpen(): boolean {
    return (
      this.clientList.every((client) => client.isSocketOpen()) &&
      this.clientCandleList.every((client) => client.isSocketOpen())
    );
  }

  isSocketConnecting(): boolean {
    return (
      this.clientList.some((client) => client.isSocketConnecting()) ||
      this.clientCandleList.some((client) => client.isSocketConnecting())
    );
  }

  getSubscriptionNumber(): number {
    const allClient: Client[] = [].concat(this.clientList, this.clientCandleList);

    return allClient.reduce(
      (acc: number, client: Client) => acc + client.getSubscriptionNumber(),
      0,
    );
  }

  private launchTimerDisconnected(): void {
    clearInterval(this.timerDisconnectedClient);
    this.timerDisconnectedClient = setInterval(
      () => this.checkDisconnectedClients(),
      this.intervalCheckConnection,
    );
    this.timerDisconnectedClient.unref();
  }

  private getLastClient(type: 'ticker' | 'trades' | 'candle'): Client {
    const list = type === 'candle' ? this.clientCandleList : this.clientList;
    const lastClient = list[list.length - 1];

    if (!lastClient || lastClient.getSubscriptionNumber() >= this.maxSubscriptions) {
      const newClient = new Client(this, () => this.emitSubscriptions());

      this.launchTimerDisconnected();
      list.push(newClient);

      newClient.connect();

      return newClient;
    }

    return lastClient;
  }

  private emitSubscriptions(): void {
    const allClient: Client[] = [].concat(this.clientList, this.clientCandleList);
    const allSubscriptions = allClient.reduce(
      (acc: Subscription[], client: Client) => acc.concat(client.getSubscriptions()),
      [],
    );

    this.emit(this.subscriptionsEvent, allSubscriptions);
  }

  private checkDisconnectedClients(): void {
    const allClient: Client[] = [].concat(this.clientList, this.clientCandleList);

    for (const client of allClient) {
      if (!client.receivedPongRecently()) {
        client.forceCloseConnection();

        continue;
      }

      client.shouldReconnectDeadSockets();
    }
  }
}
