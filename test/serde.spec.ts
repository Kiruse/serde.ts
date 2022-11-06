import { serialize, deserialize } from '../src/serde'
import { expect } from 'chai'

describe('standard serde', () => {
  // Most fundamental primitive as it is used to identify protocol for deserialization
  it('string', () => {
    const serialized = serialize('foobar');
    expect(serialized).to.be.instanceOf(Uint8Array);
    
    const { value: deserialized, length } = deserialize(serialized);
    expect(deserialized).to.equal('foobar');
    expect(length).to.equal(10);
  });
  
  it('numbers', () => {
    const serialized = serialize(10);
    expect(serialized).to.be.instanceOf(Uint8Array);
    
    const { value: deserialized, length } = deserialize(serialized);
    expect(deserialized).to.equal(10);
    expect(length).to.equal(8);
  });
});
