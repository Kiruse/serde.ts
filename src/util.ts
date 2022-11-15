import { SERDE } from './serde'

export function patchSerde<T>(obj: T, protocol: string) {
  //@ts-ignore
  obj[SERDE] = protocol;
  return obj;
}
