import type { SerdeRegistry } from './registry'

export const SERDE = Symbol('SERDE');
export const SUBSERDE = Symbol('SUBSERDE');

export type MaybeSerde = {
  [SERDE]?: string;
  [SUBSERDE]?: string;
}

export interface ITypedArray {
  BYTES_PER_ELEMENT: number;
  buffer: ArrayBuffer;
}

/** The result of a deserialization provides the deserialized value
 * and the number of consumed bytes. The latter is used to further
 * deserialize other values contained within the same buffer.
 */
 export type DeserializeResult<T> = {
  /** Deserialized value */
  value: T;
  /** Number of consumed bytes */
  length: number;
}

export interface ISerdeProtocol<T> {
  serialize(value: T, ctx?: SerializeContext): Uint8Array;
  deserialize(buffer: Uint8Array, ctx?: DeserializeContext): DeserializeResult<T>;
}

export type SerializeContext = {
  registry: SerdeRegistry;
  seen: Set<object>;
  refs: object[];
}

export type DeserializeContext = {
  registry: SerdeRegistry;
  offset: number;
}
