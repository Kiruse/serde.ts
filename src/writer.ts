import { measure } from './perf'

const BI0 = BigInt(0);
const BI8 = BigInt(8);
const BI_BYTEMASK = BigInt(0xFF);

export interface WriterOptions {
  /** Initial size of the internal buffer. Defaults to 0. */
  size?: number;
  /** Minimum number of bytes by which the internal buffer is grown on-demand. Defaults to 1024. */
  grow?: number;
}

/** The Writer helps writing serial data to a binary buffer, advancing
 * a cursor as it does.
 */
export default class Writer {
  buffer: Uint8Array;
  /** Number of actually written bytes. May diverge from `buffer.length` */
  size = 0;
  /** Position at which to write binary data. */
  cursor = 0;
  /** The minimum number of bytes by which the buffer is grown on demand. */
  grow: number;
  
  constructor({ size = 0, grow = 1024 }: WriterOptions = {}) {
    this.buffer = new Uint8Array(size);
    this.grow = grow;
  }
  
  writeBytes(bytes: Uint8Array) {
    this.fit(bytes.length);
    this.buffer.set(bytes, this.advance(bytes.length));
    return this;
  }
  
  writeBool(bool: boolean) {
    return this.writeByte(bool ? 0xFF : 0);
  }
  
  writeFlags(...flags: boolean[]) {
    if (flags.length > 8) throw new Error('Too many flags');
    return this.writeByte(
      flags.reduce(
        (prev, curr, i) => prev | Number(curr) << (7-i),
        0,
      )
    )
  }
  
  writeByte(byte: number) {
    this.fit(1);
    this.buffer[this.advance(1)] = byte;
    return this;
  }
  
  writeUInt32(num: number) {
    this.fit(4);
    new DataView(this.buffer.buffer).setUint32(this.cursor, num, true);
    this.advance(4);
    return this;
  }
  
  writeNumber(num: number) {
    this.fit(8);
    new DataView(this.buffer.buffer).setFloat64(this.advance(8), num, true);
    return this;
  }
  
  writeBigint(bi: bigint) {
    const neg = bi < BI0;
    bi = bigAbs(bi);
    const bytes = bigSizeOf(bi);
    
    this.fit(bytes + 5);
    this.writeBool(neg);
    this.writeByte(bytes);
    
    for (let b = 0; b < bytes; ++b) {
      this.writeByte(Number(bi & BI_BYTEMASK));
      bi = bi >> BI8;
    }
    if (bi !== BI0)
      throw new Error('Failed to serialize bigint');
    
    return this;
  }
  
  /** Ensure this Writer's buffer can accommodate an additional `size` bytes. If not, grow. */
  fit(size: number) {
    if (this.cursor + size > this.buffer.length) {
      this.resize(this.cursor + Math.max(this.grow, size, Math.floor(this.buffer.length / 10)));
    }
    return this;
  }
  
  resize(newSize: number) {
    measure('Writer.resize', () => {
      if (this.size < newSize) {
        const buffer = this.buffer;
        this.buffer = new Uint8Array(newSize);
        this.buffer.set(buffer);
      }
      else {
        this.buffer = this.buffer.slice(0, newSize);
      }
    });
    return this;
  }
  
  /** Advances the internal cursor by n bytes and returns its former value. */
  protected advance(n: number): number {
    const old = this.cursor;
    this.cursor += n;
    this.size = Math.max(this.cursor, this.size);
    return old;
  }
  
  compress() {
    return this.resize(this.size);
  }
  
  seek(offset: number) {
    this.cursor = Math.max(0, Math.min(offset, this.size));
    return this;
  }
  
  tell() { return this.cursor }
}

function bigSizeOf(bi: bigint) {
  bi = bigAbs(bi);
  let n = 0;
  while (bi !== BI0) {
    bi >>= BI8;
    ++n;
  }
  return n;
}

const bigAbs = (bi: bigint) => bi < BI0 ? -bi : bi;
