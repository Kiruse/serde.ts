# serde.ts
*serde.ts* defines an API for binary **ser**ialization & **de**serialization of arbitrary data types. It differs vastly from JSON and BSON in that it is implemented through `SerdeProtocol`s for few main advantages:

- A protocol can integrate any type with the API, even third party types,
- Serialized values can be deserialized appropriately, and
- Automatic recursive deserialization of class-less types allows types to deserialize type-safely (for TypeScript).

*serde* exposes the methods `serialize`, `deserialize`, `serializeAs`, `deserializeAs` as well as `SerdeProtocol<T>`. Most commonly, you will be using `serialize` and `deserialize`.

***IMPORTANT:** This library is an early WIP. API may and will change as it matures.*

## Usage
For the simplest use, you'll only use `serialize` and `deserialize`:

```typescript
import { serialize, deserialize } from '@kiruse/serde'

let serialized = serialize({
  foo: 'bar',
  answer: 42,
});

console.log(deserialize(serialized));
// Object { foo: 'bar', answer: 42 }
```

Note that at this early stage I am still implementing the various standard protocols, and that the above example likely does not work yet.

## Custom Types
Custom types which aren't object literals (such that `Object.getPrototypeOf(value) !== Object.prototype`) must fulfill two conditions:

1. Instances have `[SERDE]: string` property which informs the API of the protocol to use for serialization.
2. A custom derived `SerdeProtocol` for your type.

Implementing a protocol requires implementing its `serialize` and `deserialize` methods.

Once implemented, call `protocol.register(name)` on an instance of your protocol to register it with *serde*. You may also forcefully override an existing protocol by passing `true` as second parameter.

### Example: number
The simplest example is the standard 'number' protocol:

```typescript
import { DeserializeResult, SerdeProtocol } from '@kiruse/serde'

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
```

Note that this example is written in TypeScript and respective transformations may apply depending on your target runtime environment.

This is a simple, context-less protocol. Depending on your needs, you may create protocols dependent on some external state.

### Complex Example
But who cares about primitives when most data types are composites or worse? Ideally, your protocol can derive a simple object and de/serialize that instead:

```typescript
import { deserialize, DeserializeResult, SERDE, SerdeProtocol, serialize } from '@kiruse/serde'

class MyType {
  [SERDE] = 'mytype';
  #data: number;
  
  constructor(data: number) {
    this.#data = data;
  }
  
  foo() { return 'foo' }
  bar() { return 'bar' }
  get data() { return this.#data }
}

;(new class extends SerdeProtocol<MyType> {
  serialize(obj: MyType): Uint8Array {
    return serializeAs('object', { data: obj.data });
  }
  deserialize(buffer: Uint8Array, offset: number): DeserializeResult<MyType> {
    const { value, length } = deserializeAs('object', buffer);
    return {
      value: new MyType(value.data),
      length,
    };
  };
}).register('mytype');
```

Of course, in this case, one could just as well simply serialize `value.data` itself rather than as part of an object, but this is just a simplified example. **Note** that `serializeAs` differs from `serialize` in that it does not append the necessary protocol name for deserialization to the returned `Uint8Array` and should thus be preferred in this context.
