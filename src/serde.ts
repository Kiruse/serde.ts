import { createDeserializeContext, createSerializeContext, getProtocolRegistry, SerdeRegistry } from './registry';
import { DeserializeContext, DeserializeResult, ISerdeProtocol, ITypedArray, MaybeSerde, SERDE, SerializeContext, SUBSERDE } from './types';
import { Buffer, patchSubserde } from './util'

const BI0 = BigInt(0);
const BI8 = BigInt(8);
const BI64 = BigInt(64);
const BI_MASK64 = BigInt('0xFFFFFFFFFFFFFFFF');

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

export abstract class SerdeProtocol<T> implements ISerdeProtocol<T> {
  serialize(value: T, ctx = createSerializeContext()): Uint8Array {
    if (typeof value === 'object') {
      const obj = value as unknown as object;
      if (ctx.seen.has(obj) && !ctx.refs.includes(obj))
        ctx.refs.push(obj);
      ctx.seen.add(obj);
    }
    return this.doSerialize(ctx, value);
  }
  deserialize(buffer: Uint8Array, ctx = createDeserializeContext()): DeserializeResult<T> {
    return this.doDeserialize(ctx, buffer);
  }
  abstract doSerialize(ctx: SerializeContext, value: T): Uint8Array;
  abstract doDeserialize(ctx: DeserializeContext, buffer: Uint8Array): DeserializeResult<T>;
  
  register(name: string, force = false) {
    getProtocolRegistry().register(name, this, force);
    return this;
  }
}

export class SimpleSerdeProtocol<T, S = unknown> extends SerdeProtocol<T> {
  constructor(public readonly name: string) {
    super();
    super.register(name);
  }
  
  doSerialize(ctx: SerializeContext, value: T): Uint8Array {
    return ctx.registry.serializeAs('object', this.filter(value), ctx);
  }
  doDeserialize({ registry, offset }: DeserializeContext, buffer: Uint8Array): DeserializeResult<T> {
    const { value: data, length } = registry.deserializeAs('object', buffer, offset);
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

export const StringSerde = (new class extends SerdeProtocol<string> {
  doSerialize(_: SerializeContext, value: string): Uint8Array {
    const buffer = new Uint8Array(4 + value.length);
    new DataView(buffer.buffer).setUint32(0, value.length, true);
    buffer.set(new TextEncoder().encode(value), 4);
    return buffer;
  }
  doDeserialize({ offset }: DeserializeContext, buffer: Uint8Array): DeserializeResult<string> {
    const length = new DataView(buffer.buffer, offset).getUint32(0, true);
    const value = new TextDecoder().decode(new DataView(buffer.buffer, offset + 4, length));
    return {
      value,
      length: length + 4,
    };
  }
}).register('string');

export const UndefinedSerde = (new class extends SerdeProtocol<undefined> {
  doSerialize(_: SerializeContext, __: undefined): Uint8Array {
    return new Uint8Array(0);
  }
  doDeserialize(_: DeserializeContext, buffer: Uint8Array): DeserializeResult<undefined> {
    return {
      value: undefined,
      length: 0,
    };
  }
}).register('undef');

export const NullSerde = (new class extends SerdeProtocol<null> {
  doSerialize(_: SerializeContext, __: null): Uint8Array {
    return new Uint8Array(0);
  }
  doDeserialize(_: DeserializeContext, buffer: Uint8Array): DeserializeResult<null> {
    return {
      value: null,
      length: 0,
    };
  }
}).register('null');

export const NumberSerde = (new class extends SerdeProtocol<number> {
  doSerialize(_: SerializeContext, value: number): Uint8Array {
    const buffer = new Uint8Array(8);
    new DataView(buffer.buffer).setFloat64(0, value, true);
    return buffer;
  }
  doDeserialize({ offset }: DeserializeContext, buffer: Uint8Array): DeserializeResult<number> {
    return {
      value: new DataView(buffer.buffer, offset).getFloat64(0, true),
      length: 8,
    };
  }
}).register('number');

export const BigIntSerde = (new class extends SerdeProtocol<bigint> {
  doSerialize(_: SerializeContext, value: bigint): Uint8Array {
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
  doDeserialize({ offset }: DeserializeContext, buffer: Uint8Array): DeserializeResult<bigint> {
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
  doSerialize(_: SerializeContext, value: Buffer): Uint8Array {
    const buffer = new Uint8Array(value.length + 4);
    new DataView(buffer.buffer).setUint32(0, value.length, true);
    buffer.set(value, 4);
    return buffer;
  }
  doDeserialize({ offset }: DeserializeContext, buffer: Uint8Array): DeserializeResult<Buffer> {
    const bytes = new DataView(buffer.buffer, offset).getUint32(0, true);
    const value = globalThis.Buffer.from(buffer.slice(offset + 4, offset + bytes + 4));
    return {
      value,
      length: bytes + 4,
    };
  }
}).register('buffer');

export const TypedArraySerde = (new class extends SerdeProtocol<ITypedArray> {
  doSerialize(_: SerializeContext, value: ITypedArray): Uint8Array {
    const buffer = new Uint8Array(5 + value.buffer.byteLength);
    const view = new DataView(buffer.buffer, 0);
    view.setUint8(0, this.getArrayTypeID(value));
    view.setUint32(1, value.buffer.byteLength, true);
    buffer.set(new Uint8Array(value.buffer), 5);
    return buffer;
  }
  doDeserialize({ offset }: DeserializeContext, buffer: Uint8Array): DeserializeResult<ITypedArray> {
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
  doSerialize(ctx: SerializeContext, value: unknown[]): Uint8Array {
    const { registry } = ctx;
    const subprotocol = getSubProtocol(value, registry) ?? '';
    const subProtocolBuffer = registry.serializeAs('string', subprotocol);
    
    const subs = subprotocol
      ? value.map(v => registry.serializeAs(subprotocol, v, ctx))
      : value.map(v => registry.serialize(v, ctx));
    
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
  doDeserialize(ctx: DeserializeContext, buffer: Uint8Array): DeserializeResult<unknown[]> {
    const { registry, offset } = ctx;
    const { value: subprotocol, length: subProtoLength } = registry.deserializeAs<string>('string', buffer, offset);
    const count = new DataView(buffer.buffer, offset).getUint32(subProtoLength, true);
    
    const value = new Array<unknown>(count);
    let length = 4 + subProtoLength;
    for (let i = 0; i < count; ++i) {
      const { value: subvalue, length: sublength } = subprotocol
        ? registry.deserializeAs(subprotocol, buffer, offset + length)
        : registry.deserialize(buffer, offset + length);
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
  doSerialize(ctx: SerializeContext, value: object): Uint8Array {
    const { registry } = ctx;
    const subprotocol = getSubProtocol(value, registry) ?? '';
    const subProtocolBuffer = registry.serializeAs('string', subprotocol);
    
    const start = 4 + subProtocolBuffer.byteLength;
    const subs = Object.entries(value)
      .filter(([key, value]) =>
        !['symbol'].includes(typeof key) &&
        !['function', 'symbol'].includes(typeof value)
      )
      .map(([key, value]) => this.serializePair(ctx, subprotocol, key, value));
    
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
  doDeserialize(ctx: DeserializeContext, buffer: Uint8Array): DeserializeResult<object> {
    const { registry, offset } = ctx;
    const { value: subprotocol, length: subProtoLength } = registry.deserializeAs<string>('string', buffer, offset);
    const count = new DataView(buffer.buffer, offset).getUint32(subProtoLength, true);
    const pairs = new Array<[string, unknown]>(count);
    
    let length = 4 + subProtoLength;
    for (let i = 0; i < count; ++i) {
      const { value: pair, length: pairLength } = this.deserializePair(registry, subprotocol, buffer, offset + length);
      pairs[i] = pair as any;
      length += pairLength;
    }
    
    return {
      value: patchSubserde(Object.fromEntries(pairs), subprotocol),
      length,
    };
  }
  
  serializePair(ctx: SerializeContext, subprotocol: string | undefined, key: string, value: any): Uint8Array {
    const { registry } = ctx;
    const bytes0 = registry.serializeAs('string', key);
    const bytes1 = subprotocol
      ? registry.serializeAs(subprotocol, value, ctx)
      : registry.serialize(value, ctx);
    
    const buffer = new Uint8Array(bytes0.length + bytes1.length);
    buffer.set(bytes0, 0);
    buffer.set(bytes1, bytes0.length);
    return buffer;
  }
  deserializePair(registry: SerdeRegistry, subprotocol: string | undefined, buffer: Uint8Array, offset: number): DeserializeResult<unknown> {
    const { value: key, length: keyLength } = registry.deserializeAs<string>('string', buffer, offset);
    const { value, length: valueLength } = subprotocol
      ? registry.deserializeAs(subprotocol, buffer, offset + keyLength)
      : registry.deserialize(buffer, offset + keyLength);
    return {
      value: [key, value],
      length: keyLength + valueLength,
    };
  }
}).register('object');

function getSubProtocol(value: any, registry: SerdeRegistry): string | undefined {
  const proto = (value as MaybeSerde)[SUBSERDE];
  if (proto && typeof proto !== 'string') throw new Error('Subprotocol must be a string (registered protocol name).');
  if (proto && !registry.getProtocol(proto)) throw new Error(`No such SerdeProtocol: ${proto}`);
  return proto;
}
