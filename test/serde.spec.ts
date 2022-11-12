import { serialize, deserialize } from '../src/serde'
import { expect } from 'chai'

describe('standard serde', () => {
  // Most fundamental primitive as it is used to identify protocol for deserialization
  it('string', () => {
    const serialized = serialize('foobar');
    expect(serialized).to.be.instanceOf(Uint8Array);
    
    const { value: deserialized, length } = deserialize(serialized);
    expect(deserialized).to.equal('foobar');
    expect(length).to.equal(20);
  });
  
  it('numbers', () => {
    const serialized = serialize(10);
    expect(serialized).to.be.instanceOf(Uint8Array);
    
    const { value: deserialized, length } = deserialize(serialized);
    expect(deserialized).to.equal(10);
    expect(length).to.equal(18);
  });
  
  it('bigint', () => {
    let ref = BigInt('0x123456789123456789123456789123456789')
    let { value, length } = deserialize(serialize(ref))
    expect(value).to.equal(ref);
    expect(length).to.equal(10 + 3 * 8 + 5);
    
    ref = -BigInt('0x123456789123456789123456789123456789');
    ({ value, length } = deserialize(serialize(ref)));
    expect(value).to.equal(ref);
    expect(length).to.equal(10 + 3 * 8 + 5);
  });
  
  it('buffer', () => {
    let ref = Buffer.from([1, 2, 3]);
    let { value, length } = deserialize(serialize(ref));
    expect(value).to.deep.equal(ref);
    expect(length).to.equal(17);
    
    ref = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    ({ value, length } = deserialize(serialize(ref)));
    expect(value).to.deep.equal(ref);
    expect(length).to.equal(34);
  });
  
  it('typedarray', () => {
    {
      const ref = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const { value, length } = deserialize(serialize(ref));
      expect(value).to.deep.equal(ref);
      expect(length).to.equal(29);
    }
    
    {
      const ref = new Uint32Array([1, 2, 3, 4]);
      const { value, length } = deserialize(serialize(ref));
      expect(value).to.deep.equal(ref);
      expect(length).to.equal(35);
    }
    
    {
      const ref = new BigInt64Array([BigInt(16), BigInt(420), BigInt(69)]);
      const { value, length } = deserialize(serialize(ref));
      expect(value).to.deep.equal(ref);
      expect(length).to.equal(43);
    }
  });
  
  describe('array', () => {
    it('of primitives', () => {
      const ref = [1, 2, 3];
      const { value } = deserialize(serialize(ref));
      expect(value).to.deep.equal(ref);
    });
    
    it('nested', () => {
      const ref = [[1, 2], 3, [4, [5, 6]]];
      const { value } = deserialize(serialize(ref));
      expect(value).to.deep.equal(ref);
    });
  });
  
  describe('object', () => {
    it('simple', () => {
      const ref = { foo: 'bar', num: 42 };
      const { value } = deserialize(serialize(ref));
      expect(value).to.deep.equal(ref);
    });
    
    it('nested', () => {
      const ref = {
        foo: {
          bar: {
            value: 42,
          },
          baz: {
            value: '69',
          },
        },
      };
      const { value } = deserialize(serialize(ref));
      expect(value).to.deep.equal(ref);
    });
  });
  
  it('mixed object/array', () => {
    const ref = {
      foo: [1, 2, 3],
      bar: [
        { denom: 'uluna', amount: 42 },
        { denom: 'uust', amount: 69 },
      ],
    };
    const { value } = deserialize(serialize(ref));
    expect(value).to.deep.equal(ref);
  });
});
