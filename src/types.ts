import type { DeserializeContext, SerializeContext } from './protocol'
import type Reader from './reader'
import type Writer from './writer'

export const SERDE = Symbol('SERDE');
export const SUBSERDE = Symbol('SUBSERDE');

export type SubProtocolMap = {
  [subprotocol: string]: SubProtocol;
};

export type SubProtocol<T = unknown> = {
  serialize: Serializer<T>;
  deserialize: Deserializer<T>;
};

/** A Serializer writes `value` to `writer` in a format which allows its corresponding `Deserializer` to restore it again. */
export type Serializer<T> = (ctx: SerializeContext, writer: Writer, value: T) => void;
/** A Deserializer reads a value from `reader` in a format determined by its corresponding `Serializer`. */
export type Deserializer<T> = (ctx: DeserializeContext, reader: Reader) => T;

export type SubProtocolType<T extends SubProtocol> = ReturnType<T['deserialize']>;

/** A symbolic reference representing a cyclical object reference.
 * Stores additional data necessary to uniquely identify an object
 * during deserialization, i.e. across sessions.
 */
export class Reference {
  [SERDE] = 'reference';
  
  constructor(public readonly id: number) {}
  
  makeDereference(substitute: DeReference['substitute']): DeReference {
    return {
      id: this.id,
      substitute,
    };
  }
}

/** A symbolic reference to a cyclical object reference. Substitution
 * with the actual object is deferred at least until the actual object
 * has been fully reconstructed.
 */
export type DeReference = {
  /** The ID of this reference. Must be unique enough to enable
   * reconstruction during deserialization, i.e. across runtime
   * sessions.
   */
  id: number;
  /** Callback which receives the actual object reference and is
     * expected to substitute this symbolic reference with the actual
     * object reference.
     */
  substitute(actual: any): void;
}
