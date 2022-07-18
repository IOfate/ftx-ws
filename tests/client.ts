import parseDuration from 'parse-duration';

import { FtxWS } from '../src/index';
import { delay } from '../src/util';

const main = async () => {
  const client = new FtxWS();

  client.on('error', data => console.error(data));
  client.on('reconnect', log => console.log(log));
  client.on('subscriptions', subList => console.log(`subscriptions: ${subList.length}`));
  // const unSubFn = client.on('ticker-BTC/USD', tickerBtc => console.log(tickerBtc));
  client.on('candle-BTC/USD-1m', candleBtc => console.log(candleBtc));

  // client.subscribeTickers(['BTC/USD']);
  client.subscribeCandle('BTC/USD', '1m');

  await delay(parseDuration('5s'));

  // client.unsubscribeTicker('BTC/USD');

  // unSubFn();
};

main();
