# FTX WS

[![Node.js CI](https://github.com/IOfate/ftx-ws/actions/workflows/node.js.yml/badge.svg?branch=main)](https://github.com/IOfate/ftx-ws/actions/workflows/node.js.yml)
[![npm version](https://img.shields.io/npm/v/@iofate/ftx-ws)](https://www.npmjs.com/package/@iofate/ftx-ws)

Node.js websocket client for FTX.
Websocket API documentation: https://docs.ftx.com/#websocket-api

## IOfate

This package is made by the IOfate company and is open source, feel free to use it, share it and contribute!

## Table of contents

- [Features](#features)
- [Install](#install)
- [How to use it](#how-to-use-it)
- [API](#api)
- [Contributing](#contributing)

## Features

- [x] Price ticks
  - [x] Subscription
  - [x] Unsubscribe
- [x] Candlesticks (**emulated**)
  - [x] Subscription
  - [ ] Unsubscribe
- [x] Send ping
- [x] Emit errors by sockets
- [x] Auto-reconnect

## Install

```
$ npm install @iofate/ftx-ws
```

## How to use it

```js
import { FtxWS } from '@iofate/ftx-ws';

const main = async () => {
  const client = new FtxWS();
  const symbol = 'BTC/USDT';

  await client.connect();

  client.on(`ticker-${symbol}`, ticker => console.log(ticker));
  client.on('error', error => console.error(error));

  client.subscribeTicker(symbol);
};

main();
```

## API

This package export one class `FtxWS` and extend from [Emittery](https://www.npmjs.com/package/emittery), which allow us to dispatch and listen events.
More information about Emittery API here: https://github.com/sindresorhus/emittery#api

### General events

There are several events which are emitted in different contexts.

- `subscriptions`: emitted when a new subscription is made or closed
- `socket-not-ready`: emitted when the socket is not ready to subscribe (will try to subscribe later)
- `reconnect`: emitted when a reconnection occurred
- `retry-subscription`: emitted event when we retry to subscribe
- `error`: emitted when an error occurred
- `reconnect-candle`: emitted when a candle socket reconnect. Value emitted: `{ symbol: string; interval: string; }`

```js
import { FtxWS } from '@iofate/ftx-ws';

const client = new FtxWS();

client.on('subscriptions', subscriptions => console.log('update on subscriptions', subscriptions));
client.on('reconnect', () => console.log('a reconnection occurred'));
client.on('socket-not-ready', msg => console.warn('socket not ready', msg));
client.on('error', error => console.error(error));
```

### FtxWS = new FtxWS()

Create a new instance of FtxWS.

### ftxWS.subscribeTicker(symbol)

Subscribe to the websocket ticker of the chosen symbol.
Once called you'll be able to listen to ticker events for this symbol.

```js
import { FtxWS } from '@iofate/ftx-ws';

const ftxWS = new FtxWS();

ftxWS.subscribeTicker('BTC/USDT');
ftxWS.on('ticker-BTC/USDT', ticker => console.log(ticker));
```

### ftxWS.subscribeTickers(symbols)

Subscribe to the websocket ticker of a symbol list.
Once called you'll be able to listen to ticker events for all of those symbols.

```js
import { FtxWS } from '@iofate/ftx-ws';

const ftxWS = new FtxWS();

ftxWS.subscribeTickers(['BTC/USDT', 'ETH/USDT']);
ftxWS.on('ticker-BTC/USDT', ticker => console.log(ticker));
ftxWS.on('ticker-ETH/USDT', ticker => console.log(ticker));
```

### ftxWS.unsubscribeTicker(symbol)

Unsubscribe from the ticker websocket of the associated symbol.
Once called no more events will be dispatched.

```js
import { FtxWS } from '@iofate/ftx-ws';

const ftxWS = new FtxWS();

ftxWS.subscribeTicker('BTC/USDT');
const stopListenFn = ftxWS.on('ticker-BTC/USDT', ticker => console.log(ticker));
ftxWS.unsubscribeTicker('BTC/USDT');
stopListenFn();
```

### ftxWS.unsubscribeTickers(symbols)

Unsubscribe from the ticker websocket for the list of symbols.
Once called no more events will be dispatched.

```js
import { FtxWS } from '@iofate/ftx-ws';

const ftxWS = new FtxWS();

ftxWS.subscribeTickers(['BTC/USDT', 'ETH/USDT']);
ftxWS.unsubscribeTickers(['BTC/USDT', 'ETH/USDT']);
```

### ftxWS.subscribeCandles(symbol, timeFrame)

Subscribe to the websocket candle of the chosen symbol and time frame.
Once called you'll be able to listen to candle events for this symbol.
**`connect` method must be called before calling this one.**

Valid time frame: `'1m', '3m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M'`

```js
import { FtxWS } from '@iofate/ftx-ws';

const ftxWS = new FtxWS();

ftxWS.subscribeCandles('BTC/USDT', '1d');
ftxWS.on('candle-BTC/USDT-1d', candle => console.log(candle));
```

### ftxWS.unsubscribeCandles(symbol, timeFrame)

Unsubscribe from the candle websocket of the associated symbol.
Once called no more events will be dispatched.

```js
import { FtxWS } from '@iofate/ftx-ws';

const ftxWS = new FtxWS();

ftxWS.subscribeCandles('BTC/USDT', '1d');
const stopListenFn = ftxWS.on('candle-BTC/USDT-1d', candle => console.log(candle));
ftxWS.unsubscribeCandles('BTC/USDT', '1d');
stopListenFn();
```

### ftxWS.closeConnection()

Close the connection between you and KuCoin.
**You must unsubscribe from everything before calling this method!**

### ftxWS.isSocketOpen()

Return a boolean which indicate if the socket is open or not.

### ftxWS.isSocketConnecting()

Return a boolean which indicate if the socket is connecting or not.

### ftxWS.getSubscriptionNumber()

Return the number of subscriptions.

## Contributing

Any merge request must follow [conventional commits](https://conventionalcommits.org/) format.
