import { DeserializeContext, DeserializeResult, ISerdeProtocol, SERDE, SerializeContext } from './types';

export class SerdeRegistry {
  private _data: Record<string, ISerdeProtocol<any>> = {};
  
  getProtocol(name: string) {
    if (!this._data[name])
      throw new Error(`No SerdeProtocol registered with name: ${name}`);
    return this._data[name];
  }
  
  getProtocolOf(value: any): string {
    if (typeof value !== 'object')
      throw new Error(`Unsupported type ${typeof value}`);
    if (!(SERDE in value))
      throw new Error('Generic SerdeRegistry requires [SERDE] property in values for serialization');
    if (typeof value[SERDE] !== 'string')
      throw new Error('[SERDE] property should be a string (i.e. the protocol name)');
    return value[SERDE];
  }
  
  serialize(value: any, ctx = createSerializeContext(this)) {
    const protocol = this.getProtocolOf(value);
    
    const serializedProtocol = this.serializeAs('string', protocol);
    const serializedValue = this.serializeAs(protocol, value, ctx);
    
    const buffer = new Uint8Array(serializedProtocol.length + serializedValue.length);
    buffer.set(serializedProtocol, 0);
    buffer.set(serializedValue, serializedProtocol.length);
    return buffer;
  }
  
  serializeAs(protocol: string, value: any, ctx = createSerializeContext(this)) {
    return this.getProtocol(protocol).serialize(value, ctx);
  }
  
  deserialize<T>(buffer: Uint8Array, offset = 0) {
    const { value: protocol, length: length0 } = this.deserializeAs<string>('string', buffer, offset);
    const { value, length: length1 } = this.deserializeAs<T>(protocol, buffer, offset + length0);
    return {
      value,
      length: length0 + length1,
    };
  }
  
  deserializeAs<T>(protocol: string, buffer: Uint8Array, offset = 0) {
    const ctx: DeserializeContext = {
      registry: this,
      offset,
    };
    return this.getProtocol(protocol).deserialize(buffer, ctx) as DeserializeResult<T>;
  }
  
  register(name: string, protocol: ISerdeProtocol<any>, force = false) {
    if (!force && name in this._data)
      throw new Error(`SerdeProtocol with name already registered: ${name}`);
    this._data[name] = protocol;
    return this;
  }
  
  names() {
    return Object.keys(this._data);
  }
}

export class DefaultSerdeRegistry extends SerdeRegistry {
  getProtocolOf(value: any): string {
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
}

export const serialize = (value: any, ctx?: SerializeContext) =>
  DEFAULT_REGISTRY.serialize(value, ctx);
export const serializeAs = (protocol: string, value: any, ctx?: SerializeContext) =>
  DEFAULT_REGISTRY.serializeAs(protocol, value, ctx);
export const deserialize = (buffer: Uint8Array, offset?: number) =>
  DEFAULT_REGISTRY.deserialize(buffer, offset);
export const deserializeAs = <T>(protocol: string, buffer: Uint8Array, offset?: number) =>
  DEFAULT_REGISTRY.deserializeAs<T>(protocol, buffer, offset);

let DEFAULT_REGISTRY: SerdeRegistry = new DefaultSerdeRegistry();

export function setDefaultRegistry(registry: SerdeRegistry) {
  DEFAULT_REGISTRY = registry;
  return registry;
}

/** Get a list of all registered protocol names. */
export const getProtocolNames = () => DEFAULT_REGISTRY.names();

/** Get the protocol registry.
 * 
 * **WARNING:** This is not intended for the average use case and can mess things up. It is exposed here for more
 * advanced use cases only.
 */
export const getProtocolRegistry = () => DEFAULT_REGISTRY;

export const createSerializeContext = (registry = getProtocolRegistry()): SerializeContext => ({
  registry,
  seen: new Set(),
  refs: [],
});

export const createDeserializeContext = (registry = getProtocolRegistry()): DeserializeContext => ({
  registry,
  offset: 0,
});
