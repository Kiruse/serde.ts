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
  deserialize(buffer: Uint8Array, offset?: number): DeserializeResult<T>;
}

export type SerializeContext = {
  seen: Set<object>;
  refs: object[];
}

export const createSerializeContext = (): SerializeContext => ({ seen: new Set<object>(), refs: [] });
