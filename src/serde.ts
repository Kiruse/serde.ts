import { Buffer, patchSubserde } from './util'

const BI0 = BigInt(0);
const BI8 = BigInt(8);
const BI64 = BigInt(64);
const BI_MASK64 = BigInt('0xFFFFFFFFFFFFFFFF');

export const SERDE = Symbol('SERDE');
export const SUBSERDE = Symbol('SUBSERDE');
const REGISTRY: Record<string, SerdeProtocol<any>> = {};

/** Get a list of all registered protocol names. */
export const getProtocolNames = () => Object.keys(REGISTRY);
/** Get the protocol registry.
 * 
 * **WARNING:** This is not intended for the average use case and can mess things up. It is exposed here for more
 * advanced use cases only.
 */
export const getProtocolRegistry = () => REGISTRY;

const TYPEDARRAYS = [
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
];

export type MaybeSerde = {
  [SERDE]?: string;
  [SUBSERDE]?: string;
}

export function serialize(value: any): Uint8Array {
  const protocol = serializeType(value);
  
  const serializedProtocol = serializeAs('string', protocol);
  const serializedValue = serializeAs(protocol, value);
  
  const buffer = new Uint8Array(serializedProtocol.length + serializedValue.length);
  buffer.set(serializedProtocol, 0);
  buffer.set(serializedValue, serializedProtocol.length);
  return buffer;
}

function serializeType(value: any): string {
  if (typeof value === 'symbol')
    throw new Error('Cannot de/serialize symbols');
  if (typeof value === 'function')
    throw new Error('Cannot de/serialize functions');
  
  if (['string', 'number', 'bigint'].includes(typeof value))
    return typeof value;
  if (value === undefined)
    return 'undef';
  if (value === null)
    return 'null';
  
  if (typeof value !== 'object')
    throw new Error(`Unsupported type ${typeof value}`);
  
  if (SERDE in value) {
    if (typeof value[SERDE] !== 'string')
      throw new Error('[SERDE] property should be the name of a SerdeProtocol');
    return value[SERDE];
  }
  
  if (globalThis.Buffer?.isBuffer(value))
    return 'buffer';
  
  if (value.buffer instanceof ArrayBuffer)
    return 'typedarray';
  if (value instanceof ArrayBuffer)
    return 'arraybuffer';
  
  if (Array.isArray(value))
    return 'array';
  
  if (Object.getPrototypeOf(value) !== Object.prototype)
    throw new Error('Cannot auto-de/serialize custom class instances');
  return 'object';
}

export function serializeAs(name: string, value: any): Uint8Array {
  if (!(name in REGISTRY))
    throw new Error(`SerdeProtocol ${name} not found`);
  return REGISTRY[name].serialize(value);
}

export function deserialize<T = unknown>(buffer: Uint8Array, offset = 0): DeserializeResult<T> {
  const { value: protocol, length: length0 } = deserializeAs<string>('string', buffer, offset);
  const { value, length: length1 } = deserializeAs<T>(protocol, buffer, offset + length0);
  return {
    value,
    length: length0 + length1,
  };
}

export function deserializeAs<T = unknown>(name: string, buffer: Uint8Array, offset = 0): DeserializeResult<T> {
  if (!(name in REGISTRY))
    throw new Error(`SerdeProtocol ${name} not found`);
  return REGISTRY[name].deserialize(buffer, offset);
}

export abstract class SerdeProtocol<T> {
  abstract serialize(value: T): Uint8Array;
  abstract deserialize(buffer: Uint8Array, offset?: number): DeserializeResult<T>;
  register(name: string, force = false) {
    if (name in REGISTRY && !force)
      throw new Error(`SerdeProtocol ${name} already exists`);
    REGISTRY[name] = this;
    return this;
  }
}

export class SimpleSerdeProtocol<T, S = unknown> extends SerdeProtocol<T> {
  constructor(public readonly name: string) {
    super();
    super.register(name);
  }
  
  serialize(value: T): Uint8Array {
    return serializeAs('object', this.filter(value));
  }
  deserialize(buffer: Uint8Array, offset = 0): DeserializeResult<T> {
    const { value: data, length } = deserializeAs('object', buffer, offset);
    return {
      value: this.rebuild(data),
      length,
    };
  }
  
  /** Produce a simplified data-only version of the underlying type.
   * This data will be passed to `rebuild` during deserialization.
   * 
   * By default simply returns the original data. Note that symbols
   * and functions are skipped during 'object' SerdeProtocol serialization.
   */
  protected filter(value: T): S {
    return value as any;
  }
  
  /** Rebuild the underlying type from the generic type produced by `filter` method.
   * 
   * The default implementation simply adds the associated `[SERDE]` property.
   */
  protected rebuild(generic: any): T {
    //@ts-ignore
    return {
      [SERDE]: this.name,
      ...generic
    };
  }
  
  override register(name: string, force?: boolean): this {
    throw new Error('SimpleSerdeProtocol does not support multiple instances');
  }
}

/** Create a new `SimpleSerdeProtocol`.
 * 
 * This protocol simply extracts & recreates a data type `S` of the underlying type `T`, and otherwise de/serializes it
 * using the `ObjectSerde` protocol.
 */
export function createProtocol<T, S = unknown>(
  name: string,
  filter: ((value: T) => S),
  rebuild: ((data: S) => T),
) {
  return new class extends SimpleSerdeProtocol<T, S> {
    filter(value: T): S { return filter(value) }
    rebuild(data: S): T { return rebuild(data) }
  }(name);
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

export const StringSerde = (new class extends SerdeProtocol<string> {
  serialize(value: string): Uint8Array {
    const buffer = new Uint8Array(4 + value.length);
    new DataView(buffer.buffer).setUint32(0, value.length, true);
    buffer.set(new TextEncoder().encode(value), 4);
    return buffer;
  }
  deserialize(buffer: Uint8Array, offset = 0): DeserializeResult<string> {
    const length = new DataView(buffer.buffer, offset).getUint32(0, true);
    const value = new TextDecoder().decode(new DataView(buffer.buffer, offset + 4, length));
    return {
      value,
      length: length + 4,
    };
  }
}).register('string');

export const UndefinedSerde = (new class extends SerdeProtocol<undefined> {
  serialize(_: undefined): Uint8Array {
    return new Uint8Array(0);
  }
  deserialize(buffer: Uint8Array, offset = 0): DeserializeResult<undefined> {
    return {
      value: undefined,
      length: 0,
    };
  }
}).register('undef');

export const NullSerde = (new class extends SerdeProtocol<null> {
  serialize(_: null): Uint8Array {
    return new Uint8Array(0);
  }
  deserialize(buffer: Uint8Array, offset = 0): DeserializeResult<null> {
    return {
      value: null,
      length: 0,
    };
  }
}).register('null');

export const NumberSerde = (new class extends SerdeProtocol<number> {
  serialize(value: number): Uint8Array {
    const buffer = new Uint8Array(8);
    new DataView(buffer.buffer).setFloat64(0, value, true);
    return buffer;
  }
  deserialize(buffer: Uint8Array, offset = 0): DeserializeResult<number> {
    return {
      value: new DataView(buffer.buffer, offset).getFloat64(0, true),
      length: 8,
    };
  }
}).register('number');

export const BigIntSerde = (new class extends SerdeProtocol<bigint> {
  serialize(value: bigint): Uint8Array {
    const neg = value < BI0;
    if (neg) value = -value;
    
    const bytes = Math.ceil(this.sizeof(value) / 8);
    const buffer = new Uint8Array(bytes * 8 + 5);
    
    let view = new DataView(buffer.buffer);
    view.setUint8(0, neg ? 1 : 0);
    view.setUint32(1, bytes, true);
    
    view = new DataView(buffer.buffer, 5);
    for (let i = 0; i < bytes && value > BI0; ++i) {
      view.setBigUint64(i * 8, value & BI_MASK64, true);
      value >>= BI64;
    }
    
    return buffer;
  }
  deserialize(buffer: Uint8Array, offset = 0): DeserializeResult<bigint> {
    let value = BI0;
    let view = new DataView(buffer.buffer, offset);
    const neg = view.getUint8(0);
    const bytes = view.getUint32(1, true);
    
    view = new DataView(buffer.buffer, offset + 5);
    for (let i = 0; i < bytes; ++i) {
      const curr = view.getBigUint64(i * 8, true);
      value += curr << BI64 * BigInt(i);
    }
    
    if (neg) value = -value;
    
    return {
      value,
      length: bytes * 8 + 5,
    };
  }
  
  sizeof(bi: bigint) {
    let n = 0;
    while (bi > BI0) {
      bi >>= BI8;
      ++n;
    }
    return n;
  }
}).register('bigint');

export const BufferSerde = (new class extends SerdeProtocol<Buffer> {
  serialize(value: Buffer): Uint8Array {
    const buffer = new Uint8Array(value.length + 4);
    new DataView(buffer.buffer).setUint32(0, value.length, true);
    buffer.set(value, 4);
    return buffer;
  }
  deserialize(buffer: Uint8Array, offset = 0): DeserializeResult<Buffer> {
    const bytes = new DataView(buffer.buffer, offset).getUint32(0, true);
    const value = globalThis.Buffer.from(buffer.slice(offset + 4, offset + bytes + 4));
    return {
      value,
      length: bytes + 4,
    };
  }
}).register('buffer');

export const TypedArraySerde = (new class extends SerdeProtocol<ITypedArray> {
  serialize(value: ITypedArray): Uint8Array {
    const buffer = new Uint8Array(5 + value.buffer.byteLength);
    const view = new DataView(buffer.buffer, 0);
    view.setUint8(0, this.getArrayTypeID(value));
    view.setUint32(1, value.buffer.byteLength, true);
    buffer.set(new Uint8Array(value.buffer), 5);
    return buffer;
  }
  deserialize(buffer: Uint8Array, offset = 0): DeserializeResult<ITypedArray> {
    let view = new DataView(buffer.buffer, 0);
    const typeID = view.getUint8(offset);
    const byteLength = view.getUint32(offset + 1, true);
    const data = buffer.slice(offset + 5, offset + 5 + byteLength);
    
    const value = this.restoreTypedArray(typeID, byteLength);
    view = new DataView(value.buffer);
    data.forEach((byte, i) => {
      view.setUint8(i, byte);
    });
    
    return {
      value,
      length: byteLength + 5,
    };
  }
  
  getArrayTypeID(buffer: ITypedArray): number {
    const i = TYPEDARRAYS.findIndex(t => buffer instanceof t);
    if (i === undefined) throw new Error('Unsupported TypedArray')
    return i+1;
  }
  restoreTypedArray(id: number, byteLength: number): ITypedArray {
    if (id === 0) throw new Error('Error type ID 0');
    const type = TYPEDARRAYS[id-1];
    return new type(Math.ceil(byteLength / type.BYTES_PER_ELEMENT));
  }
}).register('typedarray');

export const ArraySerde = (new class extends SerdeProtocol<unknown[]> {
  serialize(value: unknown[]): Uint8Array {
    const subprotocol = getSubProtocol(value) ?? '';
    const subProtocolBuffer = serializeAs('string', subprotocol);
    
    const subs = subprotocol
      ? value.map(v => serializeAs(subprotocol, v))
      : value.map(serialize);
    
    const totalByteLength = subs.reduce(
      (total, curr) => total + curr.byteLength,
      4 + subProtocolBuffer.byteLength
    );
    
    const buffer = new Uint8Array(totalByteLength);
    buffer.set(subProtocolBuffer, 0);
    new DataView(buffer.buffer).setUint32(subProtocolBuffer.byteLength, value.length, true);
    
    let offset = 4 + subProtocolBuffer.byteLength;
    subs.forEach(sub => {
      buffer.set(sub, offset);
      offset += sub.byteLength;
    });
    
    return buffer;
  }
  deserialize(buffer: Uint8Array, offset = 0): DeserializeResult<unknown[]> {
    const { value: subprotocol, length: subProtoLength } = deserializeAs<string>('string', buffer, offset);
    const count = new DataView(buffer.buffer, offset).getUint32(subProtoLength, true);
    
    const value = new Array<unknown>(count);
    let length = 4 + subProtoLength;
    for (let i = 0; i < count; ++i) {
      const { value: subvalue, length: sublength } = subprotocol
        ? deserializeAs(subprotocol, buffer, offset + length)
        : deserialize(buffer, offset + length);
      value[i] = subvalue;
      length += sublength;
    }
    
    return {
      value: patchSubserde(value, subprotocol),
      length,
    };
  }
}).register('array');

export const ObjectSerde = (new class extends SerdeProtocol<object> {
  serialize(value: object): Uint8Array {
    const subprotocol = getSubProtocol(value) ?? '';
    const subProtocolBuffer = serializeAs('string', subprotocol);
    
    const start = 4 + subProtocolBuffer.byteLength;
    const subs = Object.entries(value)
      .filter(([key, value]) =>
        !['symbol'].includes(typeof key) &&
        !['function', 'symbol'].includes(typeof value)
      )
      .map(([key, value]) => this.serializePair(subprotocol, key, value));
    
    const length = subs.reduce((total, curr) => total + curr.byteLength, start);
    const buffer = new Uint8Array(length);
    buffer.set(subProtocolBuffer, 0);
    new DataView(buffer.buffer).setUint32(subProtocolBuffer.length, subs.length, true);
    
    let offset = start;
    for (const sub of subs) {
      buffer.set(sub, offset);
      offset += sub.byteLength;
    }
    
    return buffer;
  }
  deserialize(buffer: Uint8Array, offset = 0): DeserializeResult<object> {
    const { value: subprotocol, length: subProtoLength } = StringSerde.deserialize(buffer, offset);
    const count = new DataView(buffer.buffer, offset).getUint32(subProtoLength, true);
    const pairs = new Array<[string, unknown]>(count);
    
    let length = 4 + subProtoLength;
    for (let i = 0; i < count; ++i) {
      const { value: pair, length: pairLength } = this.deserializePair(subprotocol, buffer, offset + length);
      pairs[i] = pair as any;
      length += pairLength;
    }
    
    return {
      value: patchSubserde(Object.fromEntries(pairs), subprotocol),
      length,
    };
  }
  
  serializePair(subprotocol: string | undefined, key: string, value: any): Uint8Array {
    const bytes0 = serializeAs('string', key);
    const bytes1 = subprotocol ? serializeAs(subprotocol, value) : serialize(value);
    
    const buffer = new Uint8Array(bytes0.length + bytes1.length);
    buffer.set(bytes0, 0);
    buffer.set(bytes1, bytes0.length);
    return buffer;
  }
  deserializePair(subprotocol: string | undefined, buffer: Uint8Array, offset: number): DeserializeResult<unknown> {
    const { value: key, length: keyLength } = deserializeAs<string>('string', buffer, offset);
    const { value, length: valueLength } = subprotocol
      ? deserializeAs(subprotocol, buffer, offset + keyLength)
      : deserialize(buffer, offset + keyLength);
    return {
      value: [key, value],
      length: keyLength + valueLength,
    };
  }
}).register('object');

function getSubProtocol(value: any): string | undefined {
  const proto = (value as MaybeSerde)[SUBSERDE];
  if (proto && typeof proto !== 'string') throw new Error('Subprotocol must be a string (registered protocol name).');
  if (proto && !REGISTRY[proto]) throw new Error(`No such SerdeProtocol: ${proto}`);
  return proto;
}

interface ITypedArray {
  BYTES_PER_ELEMENT: number;
  buffer: ArrayBuffer;
}
