import Reader from './reader'
import { DataObject, DeReference, DeserializedData, Deserializer, Reference, SERDE, Serializer, SubProtocol, TypeMap } from './types'
import { Buffer, hash, isArrayLike } from './util'
import Writer from './writer'

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const encode = textEncoder.encode.bind(textEncoder);
const decode = textDecoder.decode.bind(textDecoder);

const TYPEDARRAYS = [
  null,
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
] as const;

export type StandardProtocolMap = {
  boolean: boolean,
  number: number,
  string: string,
  bigint: bigint,
  undef: undefined,
  null: null,
  regex: RegExp,
  regexp: RegExp,
  buffer: Buffer,
  arraybuffer: ArrayBuffer,
  typedarray: ArrayBufferView,
  array: any[],
  object: object,
  'data-object': DataObject<unknown>,
  reference: Reference,
}

export class SerdeBase<M extends TypeMap = {}> {
  constructor(protected subprotocols: Record<string, SubProtocol<any>> = {}, protected hashes = new Map<number, string>()) {}
  
  getSubProtocolOf(value: any): string {
    if (typeof value === 'symbol')
      throw new Error('Cannot serialize symbols due to their design');
    if (typeof value === 'function')
      throw new Error('Cannot serialize functions due to security concerns');
    if (value === undefined)
      return 'undef';
    if (value === null)
      return 'null';
    
    if (['boolean', 'number', 'bigint', 'string'].includes(typeof value))
      return typeof value;
    
    if (typeof value !== 'object')
      throw new Error(`Unsupported type: ${typeof value}`);
    
    if (SERDE in value) {
      if (typeof value[SERDE] !== 'string')
        throw new Error('Expected [SERDE] property to be a string (protocol name)');
      return value[SERDE];
    }
    
    if (value instanceof RegExp)
      return 'regex';
    
    if (globalThis.Buffer?.isBuffer(value))
      return 'buffer';
    if (value instanceof ArrayBuffer)
      return 'arraybuffer';
    if (ArrayBuffer.isView(value))
      return 'typedarray';
    return 'object';
  }
  
  serialize(value: any, writer = new Writer(), ctx = new SerializeContext(this)): Uint8Array {
    const subprotocol = this.getSubProtocolOf(value);
    writer.writeUInt32(hash(subprotocol));
    
    this.serializeAs(subprotocol, value, writer, ctx);
    return writer.compress().buffer;
  }
  
  deserialize(bytes: Uint8Array): unknown;
  deserialize(reader: Reader, ctx?: DeserializeContext): unknown;
  deserialize(source: Uint8Array | Reader, ctx = new DeserializeContext(this)): unknown {
    const reader = source instanceof Reader ? source : new Reader(source);
    
    const hashed: number = reader.readUInt32();
    if (!this.hashes.has(hashed))
      throw new Error(`Failed subprotocol hash lookup: ${hashed.toString(16)}`);
    
    const subprotocol = this.hashes.get(hashed)!;
    return this.deserializeAs(subprotocol, reader, ctx);
  }
  
  serializeAs<P extends string & keyof M>(
    subprotocol: P,
    value: M[P],
    writer = new Writer(),
    ctx = new SerializeContext(this),
  ) {
    if (!(subprotocol in this.subprotocols))
      throw new Error(`No such subprotocol: ${subprotocol}`);
    this.subprotocols[subprotocol].serialize(ctx, writer, value);
    return writer;
  }
  
  deserializeAs<P extends string & keyof M>(subprotocol: P, bytes: Uint8Array): M[P];
  deserializeAs<P extends string & keyof M>(subprotocol: P, reader: Reader, ctx?: DeserializeContext): M[P];
  deserializeAs<P extends string & keyof M>(
    subprotocol: P,
    source: Uint8Array | Reader,
    ctx = new DeserializeContext(this),
  ) {
    const reader = source instanceof Reader ? source : new Reader(source);
    
    if (!(subprotocol in this.subprotocols))
      throw new Error(`No such subprotocol: ${subprotocol}`);
    return this.subprotocols[subprotocol].deserialize(ctx, reader) as any;
  }
  
  set<P extends string & keyof M>(
    subprotocol: P,
    serialize: Serializer<M[P]>,
    deserialize: Deserializer<M[P]>,
    force = false,
  ) {
    const hashed = hash(subprotocol);
    if (!force && subprotocol in this.subprotocols) {
      throw new Error(`Subprotocol with name already registered: ${subprotocol}`);
    }
    if (this.hashes.has(hashed)) {
      const existing = this.hashes.get(hashed);
      if (!force || existing !== subprotocol) {
        throw new Error(`Subprotocol hash clash between "${existing}" and "${subprotocol}" (0x${hashed.toString(16)})`);
      }
    }
    
    this.subprotocols[subprotocol] = {
      serialize,
      deserialize,
    };
    this.hashes.set(hashed, subprotocol);
    return this;
  }
  
  setSimple<P extends string & keyof M, D>(
    subprotocol: P,
    filter: (value: M[P], data: <T>(value: T) => DataObject<T>) => D,
    rebuild: (data: DeserializedData<D>) => M[P],
    force = false,
  ) {
    return this.set(subprotocol,
      (ctx, writer, value) => {
        const datafn = <T>(value: T) => ({ [SERDE]: 'data-object' as const, ...value });
        ctx.serde.serialize(filter(value, datafn), writer, ctx);
      },
      (ctx, reader) => rebuild(ctx.serde.deserialize(reader, ctx) as any),
      force,
    );
  }
  
  static standard<B extends SerdeBase<StandardProtocolMap>>(blank: B): B;
  static standard(): SerdeBase<StandardProtocolMap>;
  static standard(blank = new SerdeBase<StandardProtocolMap>()) {
    return blank
      .set('boolean',
        (_, writer, value: boolean) => {
          writer.writeByte(value ? 1 : 0);
        },
        (_, reader) => !!reader.readByte(),
      )
      .set('number',
        (_, writer, value: number) => {
          writer.writeNumber(value);
        },
        (_, reader) => reader.readNumber(),
      )
      .set('string',
        (_, writer, value: string) => {
          writer.writeUInt32(value.length);
          writer.writeBytes(encode(value));
        },
        (_, reader) => {
          const length = reader.readUInt32();
          const bytes = reader.readBytes(length);
          return decode(bytes);
        }
      )
      .set('bigint',
        (_, writer, value: bigint) => {
          writer.writeBigint(value);
        },
        (_, reader) => reader.readBigint(),
      )
      .set('undef',
        () => {},
        () => undefined,
      )
      .set('null',
        () => {},
        () => null,
      )
      .set('regex',
        serializeRegex,
        deserializeRegex,
      )
      .set('regexp',
        serializeRegex,
        deserializeRegex,
      )
      .set('buffer',
        ({ serde }, writer, value: Buffer) => {
          const bytes = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
          serde.serializeAs('arraybuffer', bytes, writer);
        },
        ({ serde }, reader) => globalThis.Buffer.from(serde.deserializeAs('arraybuffer', reader)),
      )
      .set('arraybuffer',
        (_, writer, value: ArrayBuffer) => {
          writer.writeUInt32(value.byteLength);
          writer.writeBytes(new Uint8Array(value));
        },
        (_, reader) => reader.readBytes(reader.readUInt32()).buffer,
      )
      .set('typedarray',
        ({ serde }, writer, value: ArrayBufferView) => {
          const type = TYPEDARRAYS.findIndex(con => con && value instanceof con);
          if (type ===  0) throw new Error('How the fuck...');
          if (type === -1) throw new Error('Unsupported TypedArray');
          
          const bytes = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
          writer.writeByte(type);
          serde.serializeAs('arraybuffer', bytes, writer);
        },
        ({ serde }, reader) => {
          const type = reader.readByte();
          if (type <= 0 || type > TYPEDARRAYS.length) 
            throw new Error(`Invalid TypedArray index: ${type}`);
          const con = TYPEDARRAYS[type]!;
          const bytes = serde.deserializeAs('arraybuffer', reader);
          return new con(bytes);
        },
      )
      .set('array', serializeObject, deserializeObject)
      .set('object', serializeObject, deserializeObject)
      .set('data-object',
        // DataObjects are objects which don't implicitly collect references to nested objects under the assumption
        // that all data it contains is trivial and can be easily serialized. This is useful for derived subprotocols
        // which store data in nested objects to organize data more conveniently, but then access this data during rebuild.
        (ctx, writer, obj) => {
          if (isArrayLike(obj)) {
            writer.writeBool(true);
            writer.writeUInt32(obj.length);
            for (const item of obj) {
              ctx.serde.serialize(item, writer, ctx);
            }
          }
          else {
            const entries = Object.entries(obj);
            writer.writeBool(false);
            writer.writeUInt32(entries.length);
            for (const [key, value] of entries) {
              ctx.serde.serializeAs('string', key, writer);
              ctx.serde.serialize(value, writer, ctx);
            }
          }
        },
        (ctx, reader) => {
          const isArray = reader.readBool();
          const count = reader.readUInt32();
          if (isArray) {
            const result: any[] = [];
            for (let i = 0; i < count; ++i) {
              result.push(ctx.serde.deserialize(reader, ctx));
            }
            return result;
          }
          else {
            const result: any = {};
            for (let i = 0; i < count; ++i) {
              const key = ctx.serde.deserializeAs('string', reader, ctx);
              const value = ctx.serde.deserialize(reader, ctx);
              result[key] = value;
            }
            return result;
          }
        },
      )
      .set('reference',
        (_, writer, ref: Reference) => {
          writer.writeUInt32(ref.id);
        },
        (_, reader) => {
          const id = reader.readUInt32();
          return new Reference(id);
        },
      )
  }
}

/** The epicentral SerdeProtocol. Instantiate with `SerdeProtocol.standard()`. */
export default class SerdeProtocol<S extends TypeMap = {}> extends SerdeBase<S> {
  /** Register a new named subprotocol.
   * 
   * *Important:* As a new type is derived, you must store this return
   * value as your new protocol, otherwise type information is lost!
   */
  sub<P extends string, T>(
    subprotocol: P,
    serialize: Serializer<T>,
    deserialize: Deserializer<T>,
    force = false,
  ): SerdeProtocol<S & { [subprotocol in P]: T }> {
    // cheat mode engaged!
    //@ts-ignore
    this.set(subprotocol, serialize, deserialize, force);
    return this as any;
  }
  
  derive<P extends string, T, D>(
    subprotocol: P,
    filter: (value: T, data: <T>(value: T) => DataObject<T>) => D,
    rebuild: (data: DeserializedData<D>) => T,
    force = false,
  ): SerdeProtocol<S & { [p in P]: T }> {
    //@ts-ignore
    return this.setSimple(subprotocol, filter, rebuild, force);
  }
  
  static standard(blank = new SerdeProtocol({})) {
    return SerdeBase.standard(blank) as SerdeProtocol<StandardProtocolMap>;
  }
}

export class SerializeContext<M extends TypeMap = any> {
  constructor(
    public serde: SerdeBase<M>,
    public refs = new Map<object, Reference>(),
    public nextId = 0,
  ) {}
  
  // prop method signature overload style
  // so we can pass the method along by itself w/ implied `this`
  ref: { (obj: object): Reference; <T>(value: T): T; } = (value: any) => {
    // pass back thru for convenience
    if (!value || typeof value !== 'object')
      return value;
    
    if (!this.refs.has(value)) {
      this.refs.set(value, new Reference(this.nextId++));
    }
    return this.refs.get(value)!;
  }
}

export class DeserializeContext<M extends TypeMap = any> {
  constructor(
    public serde: SerdeBase<M>,
    public refs = new Set<DeReference>(),
  ) {}
  
  deref(ref: DeReference) {
    this.refs.add(ref);
    return ref;
  }
}

function serializeRegex(ctx: SerializeContext, writer: Writer, value: RegExp) {
  ctx.serde.serializeAs('string', value.toString(), writer, ctx);
}

function deserializeRegex(ctx: DeserializeContext, reader: Reader): RegExp {
  let raw: string = ctx.serde.deserializeAs('string', reader, ctx);
  let flags: string = '';
  if (raw[0] === '/') raw = raw.substring(1);
  
  const idx = raw.lastIndexOf('/');
  if (idx !== -1) {
    flags = raw.substring(idx+1);
    raw = raw.substring(0, idx);
  }
  
  return new RegExp(raw, flags);
}

/** Code shared between generic arrays & generic objects */
function serializeObject(
  ctx: SerializeContext,
  writer: Writer,
  value: unknown,
) {
  const { serde, refs } = ctx;
  const isRoot = refs.size === 0;
  if (!value) throw new Error('Invalid object null or undefined');
  ctx.ref(value as object);
  
  writer.writeFlags(isRoot, isArrayLike(value));
  
  if (isRoot) {
    writeReferences(ctx, writer);
  }
  else {
    if (isArrayLike(value)) {
      writer.writeUInt32(value.length);
      value.forEach(value => {
        serde.serialize(ctx.ref(value), writer, ctx);
      });
    }
    else {
      const entries = Object.entries(value).filter(isValidPair);
      writer.writeUInt32(entries.length);
      entries.forEach(([key, value]) => {
        serde.serializeAs('string', key, writer, ctx);
        serde.serialize(ctx.ref(value), writer, ctx);
      });
    }
  }
}

function deserializeObject(
  ctx: DeserializeContext,
  reader: Reader,
) {
  const { serde } = ctx;
  const [isRoot, isArrayLike] = reader.readFlags();
  
  if (isRoot) {
    return readReferences(ctx, reader);
  }
  else {
    let result: any;
    
    const length = reader.readUInt32();
    if (isArrayLike) {
      result = new Array(length);
      for (let i = 0; i < length; ++i) {
        result[i] = serde.deserialize(reader, ctx);
      }
    }
    else {
      const entries = new Array<[string, any]>(length);
      for (let i = 0; i < length; ++i) {
        const key = serde.deserializeAs('string', reader, ctx);
        const value = serde.deserialize(reader, ctx);
        entries[i] = [key, value];
      }
      result = Object.fromEntries(entries);
    }
    
    for (const [key, value] of Object.entries(result)) {
      if (value instanceof Reference) {
        ctx.deref(value.makeDereference(obj => {
          result[key] = obj;
        }));
      }
    }
    
    return result;
  }
}

/** `writeReferences` serializes objects found in `ctx.refs` in an ad-hoc
 * manner: it tracks which objects from `ctx.refs` have already been
 * written *as* `ctx.refs` is further populated *during* the
 * serialization of these objects.
 */
function writeReferences(
  ctx: SerializeContext,
  writer: Writer,
) {
  const written = new Set<object>();
  
  const cursorStart = writer.tell();
  writer.writeUInt32(0);
  
  let next = ctx.refs.entries().next().value as [object, Reference] | undefined;
  while (next) {
    const [obj, ref] = next;
    written.add(obj);
    
    writer.writeUInt32(ref.id);
    ctx.serde.serialize(obj, writer, ctx);
    next = find(ctx.refs, ([obj]) => !written.has(obj));
  }
  
  const cursorEnd = writer.tell();
  writer.seek(cursorStart);
  writer.writeUInt32(ctx.refs.size);
  writer.seek(cursorEnd);
}

/** `readReferences` restores references written by `writeReferences`.
 * The algorithm is entirely different as it does not involve discovery,
 * but resolution instead.
 */
function readReferences(
  ctx: DeserializeContext,
  reader: Reader,
) {
  const { serde, refs } = ctx;
  const count = reader.readUInt32();
  const objs: Record<number, object> = {};
  
  for (let i = 0; i < count; ++i) {
    const refid = reader.readUInt32();
    const obj = serde.deserialize(reader, ctx) as object;
    objs[refid] = obj;
  }
  
  for (const ref of refs) {
    if (!(ref.id in objs))
      throw new Error(`Reference ID not found: ${ref.id}`);
    ref.substitute(objs[ref.id]);
  }
  
  // sanity check: no more Reference instances should exist
  assertReferenceless(objs[0]);
  return objs[0];
}

function isValidPair([key, value]: [string, any]): boolean {
  return typeof key !== 'symbol' &&
    typeof value !== 'symbol' &&
    typeof value !== 'function';
}

function find<T>(from: Iterable<T>, condition: (item: T) => boolean) {
  for (const item of from) {
    if (condition(item))
      return item;
  }
}

function assertReferenceless(obj: any, visited = new Set()) {
  if (visited.has(obj))
    return;
  visited.add(obj);
  
  for (const key in obj) {
    const value = obj[key];
    if (value && typeof value === 'object') {
      if (value instanceof Reference) {
        console.error('Unexpected survivor reference:', value, ', in:', obj);
        throw new Error('Unexpected survivor reference');
      }
      assertReferenceless(value, visited);
    }
  }
}
