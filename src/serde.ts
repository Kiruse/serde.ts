
const BI0 = BigInt(0);
const BI8 = BigInt(8);
const BI64 = BigInt(64);
const BI_MASK64 = BigInt('0xFFFFFFFFFFFFFFFF');

export const SERDE = Symbol('SERDE');
const REGISTRY: Record<string, SerdeProtocol<any>> = {};

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
    throw new Error('Cannot serialize symbols');
  
  if (['string', 'number', 'bigint'].includes(typeof value))
    return typeof value;
  
  if (globalThis.Buffer && globalThis.Buffer.isBuffer(value))
    return 'buffer';
  
  if (value.buffer instanceof ArrayBuffer)
    return 'typedarray';
  if (value instanceof ArrayBuffer)
    return 'arraybuffer';
  
  if (typeof value !== 'object')
    throw new Error(`Unsupported type ${typeof value}`);
  
  if (Array.isArray(value))
    return 'array';
  
  if (SERDE in value) {
    if (typeof value[SERDE] !== 'string')
      throw new Error('[SERDE] property should be the name of a SerdeProtocol');
    return value[SERDE];
  }
  
  if (Object.getPrototypeOf(value) !== Object.prototype)
    throw new Error('')
  return 'object';
}

export function serializeAs(name: string, value: any): Uint8Array {
  if (!(name in REGISTRY))
    throw new Error(`SerdeProtocol ${name} not found`);
  return REGISTRY[name].serialize(value);
}

export function deserialize(buffer: Uint8Array, offset = 0): DeserializeResult<unknown> {
  const { value: protocol, length: length0 } = deserializeAs('string', buffer, offset) as DeserializeResult<string>;
  const { value, length: length1 } = deserializeAs(protocol, buffer, offset + length0);
  return {
    value,
    length: length0 + length1,
  };
}

export function deserializeAs(name: string, buffer: Uint8Array, offset = 0): DeserializeResult<unknown> {
  if (!(name in REGISTRY))
    throw new Error(`SerdeProtocol ${name} not found`);
  return REGISTRY[name].deserialize(buffer, offset);
}

export abstract class SerdeProtocol<T> {
  abstract serialize(value: T): Uint8Array;
  abstract deserialize(buffer: Uint8Array, offset: number): DeserializeResult<T>;
  register(name: string, force = false) {
    if (name in REGISTRY && !force)
      throw new Error(`SerdeProtocol ${name} already exists`);
    REGISTRY[name] = this;
    return this;
  }
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

;(new class extends SerdeProtocol<string> {
  serialize(value: string): Uint8Array {
    const buffer = new Uint8Array(4 + value.length);
    new DataView(buffer.buffer).setUint32(0, value.length, true);
    buffer.set(new TextEncoder().encode(value), 4);
    return buffer;
  }
  deserialize(buffer: Uint8Array, offset: number): DeserializeResult<string> {
    const length = new DataView(buffer.buffer, offset).getUint32(0, true);
    const value = new TextDecoder().decode(new DataView(buffer.buffer, offset + 4, length));
    return {
      value,
      length: length + 4,
    };
  }
}).register('string');

;(new class extends SerdeProtocol<number> {
  serialize(value: number): Uint8Array {
    const buffer = new Uint8Array(8);
    new DataView(buffer.buffer).setFloat64(0, value, true);
    return buffer;
  }
  deserialize(buffer: Uint8Array, offset: number): DeserializeResult<number> {
    return {
      value: new DataView(buffer.buffer, offset).getFloat64(0, true),
      length: 8,
    };
  }
}).register('number');

;(new class extends SerdeProtocol<bigint> {
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
  deserialize(buffer: Uint8Array, offset: number): DeserializeResult<bigint> {
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

if (globalThis.Buffer) {
  (new class extends SerdeProtocol<Buffer> {
    serialize(value: Buffer): Uint8Array {
      const buffer = new Uint8Array(value.length + 4);
      new DataView(buffer.buffer).setUint32(0, value.length, true);
      buffer.set(value, 4);
      return buffer;
    }
    deserialize(buffer: Uint8Array, offset: number): DeserializeResult<Buffer> {
      const bytes = new DataView(buffer.buffer, offset).getUint32(0, true);
      const value = Buffer.from(buffer.slice(offset + 4, offset + bytes + 4));
      return {
        value,
        length: bytes + 4,
      };
    }
  }).register('buffer');
}

;(new class extends SerdeProtocol<ITypedArray> {
  serialize(value: ITypedArray): Uint8Array {
    const buffer = new Uint8Array(5 + value.buffer.byteLength);
    const view = new DataView(buffer.buffer, 0);
    view.setUint8(0, this.getArrayTypeID(value));
    view.setUint32(1, value.buffer.byteLength, true);
    buffer.set(new Uint8Array(value.buffer), 5);
    return buffer;
  }
  deserialize(buffer: Uint8Array, offset: number): DeserializeResult<ITypedArray> {
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

;(new class extends SerdeProtocol<unknown[]> {
  serialize(value: unknown[]): Uint8Array {
    const subs = value.map(serialize);
    const totalByteLength = subs.reduce((total, curr) => total + curr.byteLength, 0);
    
    const buffer = new Uint8Array(4 + totalByteLength);
    new DataView(buffer.buffer).setUint32(0, value.length, true);
    
    let offset = 4;
    subs.forEach(sub => {
      buffer.set(sub, offset);
      offset += sub.byteLength;
    });
    
    return buffer;
  }
  deserialize(buffer: Uint8Array, offset: number): DeserializeResult<unknown[]> {
    const count = new DataView(buffer.buffer, offset).getUint32(0, true);
    
    const value = new Array<unknown>(count);
    let length = 4;
    for (let i = 0; i < count; ++i) {
      const { value: subvalue, length: sublength } = deserialize(buffer, offset + length);
      value[i] = subvalue;
      length += sublength;
    }
    
    return {
      value,
      length,
    };
  }
}).register('array');

;(new class extends SerdeProtocol<object> {
  serialize(value: object): Uint8Array {
    const subs = Object.entries(value)
      .filter(([key, value]) =>
        !['symbol'].includes(typeof key) &&
        !['function', 'symbol'].includes(typeof value)
      )
      .map(keypair => serializeAs('object-keypair', keypair));
    const length = subs.reduce((total, curr) => total + curr.byteLength, 4);
    
    const buffer = new Uint8Array(length);
    new DataView(buffer.buffer).setUint32(0, subs.length, true);
    
    let offset = 4;
    for (const sub of subs) {
      buffer.set(sub, offset);
      offset += sub.byteLength;
    }
    
    return buffer;
  }
  deserialize(buffer: Uint8Array, offset: number): DeserializeResult<object> {
    const count = new DataView(buffer.buffer, offset).getUint32(0, true);
    const pairs = new Array<[string, unknown]>(count);
    
    let length = 4;
    for (let i = 0; i < count; ++i) {
      const { value: pair, length: pairLength } = deserializeAs('object-keypair', buffer, offset + length);
      pairs[i] = pair as any;
      length += pairLength;
    }
    
    return {
      value: Object.fromEntries(pairs),
      length,
    };
  }
}).register('object');

;(new class extends SerdeProtocol<[string, unknown]> {
  serialize(value: [string, unknown]): Uint8Array {
    const bytes0 = serializeAs('string', value[0]);
    const bytes1 = serialize(value[1]);
    
    const buffer = new Uint8Array(bytes0.length + bytes1.length);
    buffer.set(bytes0, 0);
    buffer.set(bytes1, bytes0.length);
    return buffer;
  }
  deserialize(buffer: Uint8Array, offset: number): DeserializeResult<[string, unknown]> {
    const { value: key, length: keyByteLength } = deserializeAs('string', buffer, offset);
    const { value, length: valueByteLength } = deserialize(buffer, offset + keyByteLength);
    return {
      value: [key as string, value],
      length: keyByteLength + valueByteLength,
    };
  }
}).register('object-keypair');

interface ITypedArray {
  BYTES_PER_ELEMENT: number;
  buffer: ArrayBuffer;
}
