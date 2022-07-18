export interface MessageData<T = any> {
  type: string;
  channel: string;
  market: string;
  msg: string;
  data: T;
}
