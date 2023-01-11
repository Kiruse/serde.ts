import { expect } from 'chai'
import Serde, { SerdeAlter, StandardProtocolMap } from '../src/protocol'
import Reader from '../src/reader';
import { Reference, SERDE } from '../src/types';

const standard = Serde().standard();

describe('standard serde', () => {
  // Most fundamental primitive as it is used to identify protocol for deserialization
  describe('string', () => {
    it('serializeAs', () => {
      const bytes = standard.serializeAs('string', 'foobar').compress().buffer;
      expect(bytes).to.be.instanceOf(Uint8Array);
      
      const reader = new Reader(bytes);
      const value = standard.deserializeAs('string', reader);
      expect(value).to.equal('foobar');
      expect(reader.tell()).to.equal(22); // 8B refs, 4B hash, 4B length, 6B string
    });
    
    it('serialize', () => {
      const bytes = standard.serialize('foobar');
      expect(bytes).to.be.instanceOf(Uint8Array);
      
      const value = standard.deserialize(bytes);
      expect(value).to.equal('foobar');
    });
    
    it('empty', () => {
      const bytes = standard.serializeAs('string', '').compress().buffer;
      expect(bytes.byteLength).to.equal(16);
      
      const reader = new Reader(bytes);
      const value = standard.deserializeAs('string', reader);
      expect(value).to.equal('');
      expect(reader.tell()).to.equal(16);
    });
  });
  
  it('undefined/null', () => {
    {
      const bytes = standard.serialize(undefined);
      expect(bytes).to.be.instanceOf(Uint8Array);
      expect(bytes.length).to.equal(12);
      expect(standard.deserialize(bytes)).to.be.undefined;
    }
    
    {
      const bytes = standard.serialize(null);
      expect(bytes).to.be.instanceOf(Uint8Array);
      expect(bytes.length).to.equal(12);
      expect(standard.deserialize(bytes)).to.be.null;
    }
  });
  
  describe('number', () => {
    it('serializeAs', () => {
      const bytes = standard.serializeAs('number', 42).compress().buffer;
      expect(bytes).to.be.instanceOf(Uint8Array);
      expect(bytes.length).to.equal(20); // 8B refs header, 4B hash, 8B number
      expect(standard.deserializeAs('number', bytes)).to.equal(42);
    });
    
    it('serialize', () => {
      const bytes = standard.serialize(42);
      expect(bytes).to.be.instanceOf(Uint8Array);
      expect(bytes.length).to.equal(20);
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
  
  it('regex', () => {
    {
      const ref = /foobar/;
      expect(standard.deserialize(standard.serialize(ref))).to.deep.equal(ref);
    }
    
    {
      const ref = /^some [other] regexp?$/
      const bytes = standard.serializeAs('regexp', ref).compress().buffer;
      expect(standard.deserializeAs('regexp', bytes)).to.deep.equal(ref);
    }
    
    {
      const ref = /^yet (an)?other regexp?$/i
      const bytes = standard.serializeAs('regex', ref).compress().buffer;
      expect(standard.deserializeAs('regex', bytes)).to.deep.equal(ref);
    }
  });
  
  // utilizes arraybuffer
  describe('buffer', () => {
    it('serializeAs', () => {
      const ref = Buffer.from([1, 2, 3, 4, 5]);
      const bytes = standard.serializeAs('buffer', ref).compress().buffer;
      expect(bytes.length).to.equal(21);
      expect(standard.deserializeAs('buffer', bytes)).to.deep.equal(ref);
    });
    
    it('serialize', () => {
      const ref = Buffer.from([1, 2, 3, 4, 5]);
      const bytes = standard.serialize(ref);
      expect(bytes.length).to.equal(21);
      expect(standard.deserialize(bytes)).to.deep.equal(ref);
    });
  });
  
  // utilizes arraybuffer
  describe('typedarray', () => {
    it('Uint8Array', () => {
      const ref = new Uint8Array([1, 2, 3, 4, 5]);
      const bytes = standard.serialize(ref);
      expect(bytes.length).to.equal(22);
      expect(standard.deserialize(bytes)).to.deep.equal(ref);
    });
    
    it('Float64Array', () => {
      const ref = new Float64Array([69.69, 24.25, 4.20]);
      const bytes = standard.serialize(ref);
      expect(bytes.length).to.equal(41);
      expect(standard.deserialize(bytes)).to.deep.equal(ref);
    });
    
    it('BigUint64', () => {
      const ref = new BigUint64Array([BigInt(1), BigInt(2), BigInt(3)]);
      const bytes = standard.serialize(ref);
      expect(bytes.length).to.equal(41);
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
    
    it('empty', () => {
      const ref = [];
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
    
    it('references', () => {
      const ref2 = {
        foo: 'foo',
        bar: 'bar',
      };
      const ref1 = {
        foo: ref2,
        bar: { baz: ref2 },
      };
      const bytes = standard.serialize(ref1);
      const val = standard.deserialize(bytes) as any;
      expect(val).to.deep.equal(ref1);
      expect(val.foo).to.equal(val.bar.baz);
    });
    
    it('cyclic', () => {
      const ref1: any = {};
      const ref2 = { ref: ref1 };
      ref1.ref = ref2;
      const bytes = standard.serialize(ref1);
      const val = standard.deserialize(bytes) as any;
      expect(val.ref.ref).to.equal(val);
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
    it('simple', () => {
      class Foo {
        [SERDE] = 'test::simple';
        constructor(public data: any) {}
      }
      
      const serde = SerdeAlter().standard()
        .setSimple('test::simple',
          (value: Foo) => value.data,
          (data): Foo => new Foo(data),
        );
      
      {
        const ref = new Foo([1, [2, 3], ['4']]);
        const bytes = serde.serialize(ref);
        const value = serde.deserialize(bytes);
        expect(value).to.deep.equal(ref);
        expect(Array.isArray(value.data)).to.be.true;
      }
      
      {
        const ref = new Foo({a: 'a', b: {c: 'd'}});
        const bytes = serde.serialize(ref);
        const value = serde.deserialize(bytes) as Foo;
        expect(value.data.a).to.equal(ref.data.a)
        expect(value.data.b.c).to.equal(ref.data.b.c);
      }
    });
    
    it('data object', () => {
      class Foo {
        [SERDE] = 'test::foo';
        
        constructor(public data: {foo: string, bar: number}, public ref: object) {}
      }
      
      const serde = SerdeAlter().standard()
        .setSimple('test::foo',
          (value: Foo, data) => ({ data: data(value.data), ref: value.ref }),
          ({ data: { foo, bar }, ref }, deref) => {
            const inst = new Foo({ foo, bar }, {});
            deref(ref, ref => {
              inst.ref = ref;
            });
            return inst;
          },
        );
      const ref = { foo: new Foo({ foo: 'foo', bar: 42 }, { baz: 69.69 }) };
      const bytes = serde.serialize(ref);
      expect(serde.deserialize(bytes)).to.deep.equal(ref);
    });
    
    it('data array', () => {
      class Foo {
        [SERDE] = 'test::foo';
        constructor(public data: any[]) {}
      }
      
      const serde = SerdeAlter().standard()
        .setSimple('test::foo',
          (value: Foo, data) => ({ data: data(value.data) }),
          ({ data }) => new Foo(data),
        );
      const ref = { foo: new Foo([1, 2, '3', [4]]) };
      const bytes = serde.serialize(ref);
      const value = serde.deserialize(bytes);
      expect(value).to.deep.equal(ref);
      expect(Array.isArray(value.foo.data)).to.be.true;
    });
    
    it('root data array', () => {
      class Foo {
        [SERDE] = 'test:root-data-array';
        constructor(public data: any[]) {}
      }
      
      const serde = SerdeAlter().standard()
        .setSimple('test:root-data-array',
          ({ data }: Foo) => data,
          (data, deref): Foo => {
            const foo = new Foo(new Array(data.length));
            Reference.all(deref, data, values => {
              foo.data = values;
            });
            return foo;
          }
        )
      
      const ref = new Foo([1, {2: 3}, [4]]);
      const bytes = serde.serialize(ref);
      expect(serde.deserialize(bytes)).to.deep.equal(ref);
    });
    
    it('context', () => {
      class Foo {
        [SERDE] = 'test::custom-context';
        constructor(private registry: Record<number, string>, public id: number) {}
        get = () => this.registry[this.id];
      }
      
      const registry = {
        1: 'foo',
        2: 'bar',
      };
      
      const serde = SerdeAlter(registry).standard()
        .set('test::custom-context',
          (_, writer, value: Foo) => {
            writer.writeUInt32(value.id);
          },
          ({ serde: { ctx }}, reader): Foo => {
            return new Foo(ctx, reader.readUInt32());
          },
        );
      
      const ref1 = new Foo(registry, 1);
      let bytes = serde.serialize(ref1);
      expect(serde.deserialize(bytes).get()).to.equal('foo');
      
      const ref2 = new Foo(registry, 2);
      bytes = serde.serialize(ref2);
      expect(serde.deserialize(bytes).get()).to.equal('bar');
    });
  });
});
