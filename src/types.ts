import type { DeserializeContext, SerializeContext } from './protocol'
import type Reader from './reader'
import type Writer from './writer'

export const SERDE = Symbol('SERDE');
export const SUBSERDE = Symbol('SUBSERDE');

export type TypeMap = {
  [subprotocol: string]: unknown;
};

export interface SubProtocol<T = unknown> {
  serialize: Serializer<T>;
  deserialize: Deserializer<T>;
};

export type DataObject<T> = { [SERDE]: 'data-object' } & T;
export type DeserializedData<T> = DataObject<{
  [k in keyof T & (string | number) as T[k] extends (symbol | Function) ? never : k]:
    T[k] extends DataObject<{}>
    ? DeserializedData<T[k]>
    : T[k] extends object
    ? Reference
    : T[k];
}>;

/** A Serializer writes `value` to `writer` in a format which allows its corresponding `Deserializer` to restore it again. */
export type Serializer<T> = (ctx: SerializeContext, writer: Writer, value: T) => void;
/** A Deserializer reads a value from `reader` in a format determined by its corresponding `Serializer`. */
export type Deserializer<T> = (ctx: DeserializeContext, reader: Reader) => T;

/** A symbolic reference representing a cyclical object reference.
 * Stores additional data necessary to uniquely identify an object
 * during deserialization, i.e. across sessions.
 */
export class Reference {
  [SERDE] = 'reference';
  constructor(public readonly id: number) {}
}

export type RefWrapper = {
  <T extends DataObject<{}>>(data: T): T;
  (obj: object): Reference;
  <T>(value: T): T;
}
