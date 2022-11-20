import { SERDE, SUBSERDE } from './serde'

export type Global = typeof globalThis;
export type Buffer = Global extends { Buffer: infer B }
  ? B extends new (...args: any[]) => infer I
  ? I
  : never : never;

export function patchSerde<T>(obj: T, protocol: string) {
  //@ts-ignore
  obj[SERDE] = protocol;
  return obj;
}

export function patchSubserde<T>(obj: T, subProtocol: string) {
  //@ts-ignore
  obj[SUBSERDE] = subProtocol;
  return obj;
}

export const isArrayLike = (value: any): value is unknown[] => 'length' in value && 0 in value && value.length-1 in value;
