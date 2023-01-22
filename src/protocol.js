const Reader = require('./reader').default;
const Writer = require('./writer').default;
const perf = require('./perf');
const { DeserializeContext, Reference, SERDE, SerializeContext } = require('./types')
const { hash, isArrayLike } = require('./util')
const { measure } = perf;

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
];

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const encode = encoder.encode.bind(encoder);
const decode = decoder.decode.bind(decoder);

function Serde(ctx) {
  if (!(this instanceof Serde)) return new Serde(...arguments);
  
  this.ctx = typeof ctx === 'function' ? ctx(this) : ctx;
  this.subprotocols = {};
  this.hashes = new Map();
}

Serde.prototype.getSubProtocolOf = function(value) {
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
  if (value instanceof Set)
    return 'set';
  if (value instanceof Map)
    return 'map';
  
  if (globalThis.Buffer?.isBuffer(value))
    return 'buffer';
  if (value instanceof ArrayBuffer)
    return 'arraybuffer';
  if (ArrayBuffer.isView(value))
    return 'typedarray';
  
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype && proto !== Array.prototype) {
    throw Object.assign(
      Error('Non-plain objects must be specifically integrated by exposing the [SERDE] property'),
      { value, proto },
    );
  }
  return 'object';
}

Serde.prototype.serialize = function(value, writer, ctx) {
  const compress = !writer;
  writer = writer || new Writer();
  
  if (!ctx) {
    ctx = new SerializeContext(this);
    ctx.ref(value, undefined, true);
    measure('writeReferences', () => writeReferences(ctx, writer));
  }
  else {
    measure('serialize', () => {
      const subprotocol = this.getSubProtocolOf(value);
      writer.writeUInt32(hash(subprotocol));
      this.serializeAs(subprotocol, value, writer, ctx);
    });
  }
  
  if (compress) writer.compress();
  return writer.buffer;
}

Serde.prototype.deserialize = function(source, ctx) {
  const reader = source instanceof Reader ? source : new Reader(source);
  
  if (!ctx) {
    return measure(
      'readReferences',
      () => readReferences(new DeserializeContext(this), reader),
    );
  }
  else {
    return measure(
      'deserialize',
      () => {
        const subprotocol = this.protocolFromHash(reader.readUInt32());
        return this.deserializeAs(subprotocol, reader, ctx);
      }
    );
  }
}

Serde.prototype.serializeAs = function(
  subprotocol,
  value,
  writer = new Writer(),
  ctx,
) {
  if (!(subprotocol in this.subprotocols))
    throw new Error(`No such subprotocol: ${subprotocol}`);
  
  if (!ctx) {
    ctx = new SerializeContext(this);
    ctx.ref(value, subprotocol, true);
    measure('writeReferences', () => writeReferences(ctx, writer));
  }
  else {
    measure(
      `[${subprotocol}].serialize`,
      () => this.subprotocols[subprotocol].serialize(ctx, writer, value),
    );
  }
  return writer;
}

Serde.prototype.deserializeAs = function(
  subprotocol,
  source,
  ctx,
) {
  const reader = source instanceof Reader ? source : new Reader(source);

  if (!(subprotocol in this.subprotocols))
    throw new Error(`No such subprotocol: ${subprotocol}`);
  
  if (!ctx) {
    return measure('readReferences',
      () => readReferences(new DeserializeContext(this), reader),
    );
  } else {
    return measure(
      `[${subprotocol}].deserialize`,
      () => this.subprotocols[subprotocol].deserialize(ctx, reader),
    );
  }
}

Serde.prototype.protocolFromHash = function(hash) {
  if (!this.hashes.has(hash))
    throw Error(`Failed subprotocol hash lookup: ${hash.toString(16)}`);
  return this.hashes.get(hash);
}

Serde.prototype.set = function(
  subprotocol,
  serialize,
  deserialize,
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

Serde.prototype.setSimple = function(
  subprotocol,
  filter,
  rebuild,
  force = false,
) {
  return this.set(subprotocol,
    (ctx, writer, value) => {
      const datafn = value => cloneData(value);
      const data = filter(value, datafn);
      if (data && typeof data === 'object' && !data[SERDE]) data[SERDE] = 'data-object';
      ctx.serde.serialize(data, writer, ctx);
    },
    (ctx, reader) => rebuild(ctx.serde.deserialize(reader, ctx), ctx.deref),
    force,
  );
}

Serde.prototype.standard = function() {
  return this
    .set('boolean',
      (_, writer, value) => {
        writer.writeByte(value ? 1 : 0);
      },
      (_, reader) => !!reader.readByte(),
    )
    .set('number',
      (_, writer, value) => {
        writer.writeNumber(value);
      },
      (_, reader) => reader.readNumber(),
    )
    .set('string',
      (_, writer, value) => {
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
      (_, writer, value) => {
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
    .set('set',
      (ctx, writer, value) => {
        const { serde, ref } = ctx;
        writer.writeUInt32(value.size);
        for (const item of value) {
          serde.serialize(ref(item), writer, ctx);
        }
      },
      (ctx, reader) => {
        const { serde, deref } = ctx;
        const size = reader.readUInt32();
        const result = new Set();
        for (let i = 0; i < size; ++i) {
          const item = serde.deserialize(reader, ctx);
          deref(item, act => result.add(act));
        }
        return result;
      },
    )
    .set('map',
      (ctx, writer, map) => {
        const { serde, ref } = ctx;
        writer.writeUInt32(map.size);
        for (const [key, value] of map.entries()) {
          serde.serialize(ref(key), writer, ctx);
          serde.serialize(ref(value), writer, ctx);
        }
      },
      (ctx, reader) => {
        const { serde, deref } = ctx;
        const size = reader.readUInt32();
        const result = new Map();
        for (let i = 0; i < size; ++i) {
          const key = serde.deserialize(reader, ctx);
          const value = serde.deserialize(reader, ctx);
          Reference.all(deref, [key, value], ([key, value]) => {
            result.set(key, value);
          });
        }
        return result;
      },
    )
    .set('buffer',
      (ctx, writer, value) => {
        const bytes = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        ctx.serde.serializeAs('arraybuffer', bytes, writer, ctx);
      },
      (ctx, reader) => globalThis.Buffer.from(ctx.serde.deserializeAs('arraybuffer', reader, ctx)),
    )
    .set('arraybuffer',
      (_, writer, value) => {
        writer.writeUInt32(value.byteLength);
        writer.writeBytes(new Uint8Array(value));
      },
      (_, reader) => reader.readBytes(reader.readUInt32()).buffer,
    )
    .set('typedarray',
      (ctx, writer, value) => {
        const type = TYPEDARRAYS.findIndex(con => con && value instanceof con);
        if (type ===  0) throw new Error('How the fuck...');
        if (type === -1) throw new Error('Unsupported TypedArray');
        
        const bytes = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        writer.writeByte(type);
        ctx.serde.serializeAs('arraybuffer', bytes, writer, ctx);
      },
      (ctx, reader) => {
        const type = reader.readByte();
        if (type <= 0 || type > TYPEDARRAYS.length) 
          throw new Error(`Invalid TypedArray index: ${type}`);
        const con = TYPEDARRAYS[type];
        const bytes = ctx.serde.deserializeAs('arraybuffer', reader, ctx);
        return new con(bytes);
      },
    )
    .set('array', serializeObject, deserializeObject)
    .set('object', serializeObject, deserializeObject)
    .set('data-object', serializeObject, deserializeObject)
    .set('reference',
      (_, writer, ref) => {
        writer.writeUInt32(ref.id);
      },
      (_, reader) => {
        const id = reader.readUInt32();
        return new Reference(id);
      },
    )
}

module.exports = Serde;
Serde.measurePerformance = () => perf.enable();
Serde.Mapped = () => Serde;
Serde.SerdeBase = Serde;
Serde.SerdeAlter = Serde;


function serializeRegex(ctx, writer, value) {
  ctx.serde.serializeAs('string', value.toString(), writer, ctx);
}

function deserializeRegex(ctx, reader) {
  let raw = ctx.serde.deserializeAs('string', reader, ctx);
  let flags = '';
  if (raw[0] === '/') raw = raw.substring(1);
  
  const idx = raw.lastIndexOf('/');
  if (idx !== -1) {
    flags = raw.substring(idx+1);
    raw = raw.substring(0, idx);
  }
  
  return new RegExp(raw, flags);
}

/** Code shared between generic arrays & generic objects */
function serializeObject(ctx, writer, value) {
  const { serde } = ctx;
  if (!value) throw new Error('Invalid object null or undefined');
  
  if (isArrayLike(value)) {
    writer.writeBool(true);
    writer.writeUInt32(value.length);
    value.forEach(value => {
      serde.serialize(ctx.ref(value), writer, ctx);
    });
  }
  else {
    const entries = Object.entries(value).filter(isValidPair);
    writer.writeBool(false);
    writer.writeUInt32(entries.length);
    entries.forEach(([key, value]) => {
      serde.serializeAs('string', key, writer, ctx);
      serde.serialize(ctx.ref(value), writer, ctx);
    });
  }
}

function deserializeObject(ctx, reader) {
  const { serde } = ctx;
  const isArrayLike = reader.readBool();
  let result;
  
  const length = reader.readUInt32();
  if (isArrayLike) {
    result = new Array(length);
    for (let i = 0; i < length; ++i) {
      result[i] = serde.deserialize(reader, ctx);
    }
  }
  else {
    const entries = new Array(length);
    for (let i = 0; i < length; ++i) {
      const key = serde.deserializeAs('string', reader, ctx);
      const value = serde.deserialize(reader, ctx);
      entries[i] = [key, value];
    }
    result = Object.fromEntries(entries);
  }
  
  for (const [key, value] of Object.entries(result)) {
    if (value instanceof Reference) {
      ctx.deref(value, obj => {
        result[key] = obj;
      });
    }
  }
  
  return result;
}

/** `writeReferences` serializes objects found in `ctx.refs` in an ad-hoc
 * manner: it tracks which objects from `ctx.refs` have already been
 * written *as* `ctx.refs` is further populated *during* the
 * serialization of these objects.
 */
function writeReferences(ctx, writer) {
  const written = new Set();
  
  const cursorStart = writer.tell();
  writer.writeUInt32(0);
  
  let next = ctx.refs.pop();
  while (next) {
    const [obj, ref] = next;
    written.add(obj);
    
    writer.writeUInt32(ref.id);
    
    if (ref.subprotocol) {
      writer.writeBool(true);
      writer.writeUInt32(hash(ref.subprotocol));
      ctx.serde.serializeAs(ref.subprotocol, obj, writer, ctx);
    } else {
      writer.writeBool(false);
      ctx.serde.serialize(obj, writer, ctx);
    }
    
    next = measure('writeReferences.findNext', () => ctx.refs.pop());
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
function readReferences(ctx, reader) {
  const { serde, refs } = ctx;
  const count = reader.readUInt32();
  const objs = {};
  
  for (let i = 0; i < count; ++i) {
    const refid = reader.readUInt32();
    
    const subprotocolOverride = reader.readBool();
    if (subprotocolOverride) {
      const subprotocol = serde.protocolFromHash(reader.readUInt32());
      objs[refid] = ctx.serde.deserializeAs(subprotocol, reader, ctx);
    } else {
      objs[refid] = ctx.serde.deserialize(reader, ctx);
    }
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

function isValidPair([key, value]) {
  return typeof key !== 'symbol' &&
    typeof value !== 'symbol' &&
    typeof value !== 'function';
}

function assertReferenceless(obj, visited = new Set()) {
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

function cloneData(data) {
  let clone;
  if (isArrayLike(data)) {
    clone = [...data];
  } else {
    clone = {...data};
  }
  clone[SERDE] = 'data-object';
  return clone;
}
