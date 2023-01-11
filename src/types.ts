import type Serde from './protocol'
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
export type DeserializedData<T> =
  T extends object
  ? T extends (infer E)[]
    ? DeserializedData<E>[]
    : {
      [k in keyof T & (string | number) as T[k] extends (symbol | Function) ? never : k]:
        T[k] extends DataObject<{}>
        ? DeserializedData<T[k]>
        : T[k] extends object
        ? Reference
        : T[k];
    }
  : T;

/** A Serializer writes `value` to `writer` in a format which allows its corresponding `Deserializer` to restore it again. */
export type Serializer<T, M extends TypeMap = any, Ctx = {}> = (ctx: SerializeContext<M, Ctx>, writer: Writer, value: T) => void;
/** A Deserializer reads a value from `reader` in a format determined by its corresponding `Serializer`. */
export type Deserializer<T, M extends TypeMap = any, Ctx = {}> = (ctx: DeserializeContext<M, Ctx>, reader: Reader) => T;

export class SerializeContext<M extends TypeMap = any, Ctx = {}> {
  refs = new Map<any, Reference>();
  nextId = 0;
  
  constructor(public serde: Serde<M, Ctx>) {}
  
  // prop method signature overload style
  // so we can pass the method along by itself w/ implied `this`
  ref: RefWrapper = (value: any, force = false) => {
    // pass back thru for convenience
    if (!force && (!value || typeof value !== 'object' || value[SERDE] === 'data-object'))
      return value;
    
    if (!this.refs.has(value)) {
      this.refs.set(value, new Reference(this.nextId++));
    }
    return this.refs.get(value)!;
  }
}

export class DeserializeContext<M extends TypeMap = any, Ctx = {}> {
  constructor(
    public serde: Serde<M, Ctx>,
    public refs = new Set<DeReference>(),
  ) {}
  
  /** "Dereference" the given reference. `substitute` will be called with the actual object reference value. */
  deref = (ref: any, substitute: DeReference['substitute']) => {
    if (ref instanceof Reference) {
      this.refs.add({
        id: ref.id,
        substitute,
      });
    }
    else {
      substitute(ref);
    }
  }
}

/** A symbolic reference representing a cyclical object reference.
 * Stores additional data necessary to uniquely identify an object
 * during deserialization, i.e. across sessions.
 */
export class Reference {
  [SERDE] = 'reference';
  constructor(public readonly id: number) {}
  
  static all(deref: DeserializeContext['deref'], refs: any[], callback: (values: any[]) => void) {
    // actual values w/o References remaining
    const values = refs.slice();
    // track which refs have been resolved
    // refs which aren't actually references are immediately considered resolved
    const done = refs.map(r => !(r instanceof Reference));
    
    // helper callback for checking if all references have been resolved
    const check = () => done.reduce((prev, curr) => prev && curr, true);
    
    // resolve references & re-check
    refs.forEach((ref, i) => {
      if (!(ref instanceof Reference)) return;
      deref(ref, value => {
        done[i] = true;
        values[i] = value;
        check() && callback(values);
      });
    });
    
    // check in case no references have been passed
    // in which case above loop & its included check would never be called
    check() && callback(values);
  }
}

type DeReference = {
  id: number;
  substitute(actual: any): void;
}

/** Callback type which injects the `[SERDE]: 'data-object'` property into the given object. */
export type DataWrapper = <T extends object>(value: T) => DataObject<T>;

export type RefWrapper = {
  <T extends DataObject<{}>>(data: T): T;
  (obj: object): Reference;
  <T>(value: T): T;
}
