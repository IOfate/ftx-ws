/** Root */
import { CandleEmulator } from '../candle-emulator';

/** Models */
import { Subscription } from './subscription.model';

export interface CandleSubscription extends Subscription {
  type: 'candle';
  interval: string;
  emulator: CandleEmulator;
}
