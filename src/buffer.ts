import { DeserializeResult, SerdeProtocol } from "./serde";

/** SerdeProtocol specialized for NodeJS `Buffer`s.
 * 
 * Because this library is intended to be used in a browser as well
 * you must manually import this protocol if you wish to use it.
 */
const BufferSerde = (new class extends SerdeProtocol<Buffer> {
  serialize(value: Buffer): Uint8Array {
    const buffer = new Uint8Array(value.length + 4);
    new DataView(buffer.buffer).setUint32(0, value.length, true);
    buffer.set(value, 4);
    return buffer;
  }
  deserialize(buffer: Uint8Array, offset = 0): DeserializeResult<Buffer> {
    const bytes = new DataView(buffer.buffer, offset).getUint32(0, true);
    const value = Buffer.from(buffer.slice(offset + 4, offset + bytes + 4));
    return {
      value,
      length: bytes + 4,
    };
  }
}).register('buffer');

export default BufferSerde;
