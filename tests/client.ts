import parseDuration from 'parse-duration';

import { FtxWS } from '../src/index';
import { delay } from '../src/util';

const main = async () => {
  const client = new FtxWS();

  client.on('error', data => console.error(data));
  client.on('reconnect', log => console.log(log));
  client.on('subscriptions', subList => console.log(`subscriptions: ${subList.length}`));
  const unSubFn = client.on('ticker-BTC/USD', tickerBtc => console.log(tickerBtc));
  client.on('candle-BTC/USD-1m', candleBtc => console.log(candleBtc));
  client.on('trades-BTC/USD', tradesBtc => console.log(tradesBtc));

  client.subscribeTickers(['BTC/USD', 'ETH/USD']);
  client.subscribeTicker('LTC/USD');
  client.subscribeTicker('BNB/USD');
  client.subscribeTicker('UNI/USD');
  client.subscribeTicker('XRP/USD');
  client.subscribeTicker('SOL/USD');
  client.subscribeTicker('NEAR/USD');
  client.subscribeTicker('YFI/USD');
  client.subscribeTicker('SNX/USD');
  client.subscribeTicker('CRO/USD');
  client.subscribeTicker('COMP/USD');
  client.subscribeCandle('BTC/USD', '1m');
  client.subscribeCandle('ETH/USD', '1m');
  client.subscribeTrades('BTC/USD');

  await delay(parseDuration('4s'));

  client.unsubscribeTicker('BTC/USD');

  setTimeout(() => {
    client.unsubscribeCandle('BTC/USD', '1m');
  }, parseDuration('2m'));

  unSubFn();
};

main();
