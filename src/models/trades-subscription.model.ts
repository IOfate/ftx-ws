import { Subscription } from './subscription.model';

export interface TradesSubscription extends Subscription {
  type: 'trades';
  forCandle: boolean;
}
