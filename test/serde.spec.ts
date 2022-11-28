import { expect } from 'chai'
import SerdeProtocol from '../src/protocol'
import Reader from '../src/reader';
import { SERDE } from '../src/types';

const standard = SerdeProtocol.standard();

describe('standard serde', () => {
  // Most fundamental primitive as it is used to identify protocol for deserialization
  describe('string', () => {
    it('serializeAs', () => {
      const bytes = standard.serializeAs('string', 'foobar').compress().buffer;
      expect(bytes).to.be.instanceOf(Uint8Array);
      
      const reader = new Reader(bytes);
      const value = standard.deserializeAs('string', reader);
      expect(value).to.equal('foobar');
      expect(reader.cursor).to.equal(10);
    });
    
    it('serialize', () => {
      const bytes = standard.serialize('foobar');
      expect(bytes).to.be.instanceOf(Uint8Array);
      
      const value = standard.deserialize(bytes);
      expect(value).to.equal('foobar');
    });
    
    it('empty', () => {
      const bytes = standard.serializeAs('string', '').compress().buffer;
      expect(bytes.byteLength).to.equal(4);
      
      const reader = new Reader(bytes);
      const value = standard.deserializeAs('string', reader);
      expect(value).to.equal('');
      expect(reader.cursor).to.equal(4);
    });
  });
  
  it('undefined/null', () => {
    {
      const bytes = standard.serialize(undefined);
      expect(bytes).to.be.instanceOf(Uint8Array);
      expect(bytes.length).to.equal(4);
      expect(standard.deserialize(bytes)).to.be.undefined;
    }
    
    {
      const bytes = standard.serialize(null);
      expect(bytes).to.be.instanceOf(Uint8Array);
      expect(bytes.length).to.equal(4);
      expect(standard.deserialize(bytes)).to.be.null;
    }
  });
  
  describe('number', () => {
    it('serializeAs', () => {
      const bytes = standard.serializeAs('number', 42).compress().buffer;
      expect(bytes).to.be.instanceOf(Uint8Array);
      expect(bytes.length).to.equal(8);
      expect(standard.deserializeAs('number', bytes)).to.equal(42);
    });
    
    it('serialize', () => {
      const bytes = standard.serialize(42);
      expect(bytes).to.be.instanceOf(Uint8Array);
      expect(bytes.length).to.equal(12);
      expect(standard.deserialize(bytes)).to.equal(42);
    });
  });
  
  it('bigint', () => {
    {
      const ref = BigInt(420696969420);
      expect(standard.deserialize(standard.serialize(ref))).to.equal(ref);
    }
    
    {
      const ref = BigInt('0x123456789123456789123456789123456789');
      expect(standard.deserialize(standard.serialize(ref))).to.equal(ref);
    }
  });
  
  // utilizes arraybuffer
  describe('buffer', () => {
    it('serializeAs', () => {
      const ref = Buffer.from([1, 2, 3, 4, 5]);
      const bytes = standard.serializeAs('buffer', ref).compress().buffer;
      expect(bytes.length).to.equal(9);
      expect(standard.deserializeAs('buffer', bytes)).to.deep.equal(ref);
    });
    
    it('serialize', () => {
      const ref = Buffer.from([1, 2, 3, 4, 5]);
      const bytes = standard.serialize(ref);
      expect(bytes.length).to.equal(13);
      expect(standard.deserialize(bytes)).to.deep.equal(ref);
    });
  });
  
  // utilizes arraybuffer
  describe('typedarray', () => {
    it('Uint8Array', () => {
      const ref = new Uint8Array([1, 2, 3, 4, 5]);
      const bytes = standard.serialize(ref);
      expect(bytes.length).to.equal(14);
      expect(standard.deserialize(bytes)).to.deep.equal(ref);
    });
    
    it('Float64Array', () => {
      const ref = new Float64Array([69.69, 24.25, 4.20]);
      const bytes = standard.serialize(ref);
      expect(bytes.length).to.equal(33);
      expect(standard.deserialize(bytes)).to.deep.equal(ref);
    });
    
    it('BigUint64', () => {
      const ref = new BigUint64Array([BigInt(1), BigInt(2), BigInt(3)]);
      const bytes = standard.serialize(ref);
      expect(bytes.length).to.equal(33);
      expect(standard.deserialize(bytes)).to.deep.equal(ref);
    });
  });
  
  describe('array', () => {
    it('of primitives', () => {
      {
        const ref = [1, 2, 3, 4, 5];
        const bytes = standard.serialize(ref);
        expect(standard.deserialize(bytes)).to.deep.equal(ref);
      }
      
      {
        const ref = ['a', 'b', 'c', 'd', 'e'];
        const bytes = standard.serialize(ref);
        expect(standard.deserialize(bytes)).to.deep.equal(ref);
      }
    });
    
    it('nested', () => {
      const ref = [1, 2, [3, 4, 5, [6]], ['7', [8, 9]]];
      const bytes = standard.serialize(ref);
      expect(standard.deserialize(bytes)).to.deep.equal(ref);
    });
    
    it.skip('subserde', () => {
      throw new Error('not yet implemented')
    });
  });
  
  describe('object', () => {
    it('simple', () => {
      const ref = {
        foo: 'foo',
        bar: 'bar',
        num: 42,
      };
      const bytes = standard.serialize(ref);
      expect(standard.deserialize(bytes)).to.deep.equal(ref);
    });
    
    it('nested', () => {
      const ref = {
        foo: 'foo',
        bar: {
          baz: 'baz',
          num: 42,
        },
        num: 69.69,
      };
      const bytes = standard.serialize(ref);
      expect(standard.deserialize(bytes)).to.deep.equal(ref);
    });
    
    it.skip('subserde', () => {
      throw new Error('not yet implemented');
    });
  });
  
  // they're technically the same anyways, but...
  it('mixed object/array', () => {
    const ref = {
      foo: [1, 2, 3],
      bar: [
        { denom: 'uluna', amount: 42 },
        { denom: 'uust', amount: 64 },
      ],
    };
    const bytes = standard.serialize(ref);
    expect(standard.deserialize(bytes)).to.deep.equal(ref);
  });
  
  describe('custom', () => {
    it('sub', () => {
      type TestType = {
        [SERDE]: 'test::sub';
        foo: string;
        bar: number;
      }
      
      const serde = SerdeProtocol.standard()
        .sub('test::sub',
          ({ serde }, writer, value: TestType) => {
            serde.serializeAs('string', value.foo, writer);
            writer.writeNumber(value.bar);
          },
          ({ serde }, reader) => ({
            [SERDE]: 'test::sub' as const,
            foo: serde.deserializeAs('string', reader),
            bar: reader.readNumber(),
          }),
        );
      
      const ref: TestType = {
        [SERDE]: 'test::sub',
        foo: 'foo',
        bar: 42,
      };
      const bytes = serde.serialize(ref);
      expect(serde.deserialize(bytes)).to.deep.equal(ref);
    });
    
    it('derive', () => {
      type TestType = {
        [SERDE]: 'test::derive',
        foo: string;
        bar: number;
      }
      
      const serde = SerdeProtocol.standard()
        .derive('test::derive',
          ({ foo, bar }: TestType) => ({ foo, bar }),
          ({ foo, bar }) => ({
            [SERDE]: 'test::derive',
            foo,
            bar,
          }),
        );
      
      const ref: TestType = {
        [SERDE]: 'test::derive',
        foo: 'foo',
        bar: 69.69,
      };
      const bytes = serde.serialize(ref);
      expect(serde.deserialize(bytes)).to.deep.equal(ref);
    });
  });
});
