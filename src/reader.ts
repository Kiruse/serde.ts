const BI8 = BigInt(8);

type Flags = [boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean];

/** The Reader helps reading serial data from a binary buffer,
 * advancing a cursor as it does.
 */
export default class Reader {
  constructor(
    public buffer: Uint8Array,
    public cursor = 0,
  ) {}
  
  readBytes(size: number) {
    const cursor = this.advance(size);
    return this.buffer.slice(cursor, cursor + size);
  }
  
  readBool() {
    return !!this.readByte();
  }
  
  readFlags(): Flags {
    const byte = this.readByte();
    const flags = new Array<boolean>(8).fill(false) as Flags;
    
    for (let i = 0; i < 8; ++i) {
      flags[i] = Boolean(byte & 1 << (7-i));
    }
    
    return flags;
  }
  
  readByte() {
    return this.buffer[this.advance(1)];
  }
  
  readUInt32() {
    return new DataView(this.buffer.buffer, this.advance(4)).getUint32(0, true);
  }
  
  readNumber() {
    return new DataView(this.buffer.buffer, this.advance(8)).getFloat64(0, true);
  }
  
  readBigint() {
    const neg = this.readBool();
    const bytes = this.readByte();
    
    let bi = BigInt(0);
    for (let b = 0; b < bytes; ++b) {
      const byte = BigInt(this.readByte());
      bi = bi | byte << (BI8 * BigInt(b));
    }
    
    return neg ? -bi : bi;
  }
  
  advance(count: number) {
    const cursor = this.cursor;
    this.cursor += count;
    return cursor;
  }
}
