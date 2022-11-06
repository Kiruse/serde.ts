
export const SERDE = Symbol('SERDE');
const REGISTRY: Record<string, SerdeProtocol<any>> = {};

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
  if (Object.getPrototypeOf(value) === Object.prototype)
    return 'object';
  
  if (!(SERDE in value) || typeof value[SERDE] !== 'string')
    throw new Error('Custom types must provide [SERDE] property');
  return value[SERDE];
}

export function serializeAs(name: string, value: any): Uint8Array {
  if (!(name in REGISTRY))
    throw new Error(`SerdeProtocol ${name} not found`);
  return REGISTRY[name].serialize(value);
}

export function deserialize(buffer: Uint8Array, offset = 0): DeserializeResult<unknown> {
  const { value: protocol, length } = deserializeAs('string', buffer, offset) as DeserializeResult<string>;
  return deserializeAs(protocol, buffer, offset + length);
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
