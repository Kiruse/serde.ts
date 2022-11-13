# serde.ts
*serde* defines an API for binary **ser**ialization & **de**serialization of arbitrary data types. It differs vastly from JSON and BSON in that it is implemented through `SerdeProtocol`s for few main advantages:

- A protocol can integrate any type with the API, even third party types,
- Serialized values can be deserialized appropriately, and
- Automatic recursive deserialization of class-less types allows types to deserialize type-safely (for TypeScript).

*serde* exposes the methods `serialize`, `deserialize`, `serializeAs`, `deserializeAs` as well as `SerdeProtocol<T>`. Most commonly, you will be using `serialize` and `deserialize`.

When TypeScript's decorators feature matures, serde will use these to deliver an even easier developer experience.

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

If you need TypeScript support you may use the protocols directly:

```typescript
import { NumberSerde } from '@kiruse/serde'

let serialized = NumberSerde.serialize(42);
let deserialized = NumberSerde.deserialize(serialized);
// deserialized is a `number`
```

Standard protocols for the various basic types exist. You can get a list of all currently registered protocols with `getProtocolNames()`.

## `createProtocol`
Unless you have special needs for the binary format of your data type, `createProtocol` provides a streamlined workflow to easily integrate a custom type with serde. Following is its signature:

```typescript
function createProtocol<T, S>(
  name: string,
  filter: ((value: T) => S) | undefined | null,
  rebuild: ((data: S) => T) | undefined | null,
): SimpleSerdeProtocol<T, S>;
```

`name` will be the name with which your protocol is registered. This name is prefixed to your binary data when calling `serialize`, and used to restore your data when calling `deserialize`. Name must be unique, otherwise the system will throw.

`filter` allows you to extract a simplified data-only version of your underlying type. This can also be used to cut out data which can be inferred from other properties, or perhaps from the program context.

`rebuild` then allows reconstructing your underlying type from the data returned by `filter`. Accordingly, it can also be used to enrich your object.

Although it returns a `SimpleSerdeProtocol` which you could implement yourself, building it with `createProtocol` is more convenient as both `S` and `T` type parameters can be inferred from `filter` and `rebuild`. Effectively, you normally don't have to explicitly define `S`.

**Example**

```typescript
import { SERDE, createProtocol } from './src';

type MyType = {
  [SERDE]: 'my-type';
  foo: string;
  bar: number;
  deserialized: boolean;
}

const MyProtocol = createProtocol(
  'my-type',
  ({ foo, bar }: MyType) => ({ foo, bar }),
  ({ foo, bar }): MyType => ({
    [SERDE]: 'my-type',
    foo,
    bar,
    deserialized: true,
  }),
);

const serialized = MyProtocol.serialize({
  [SERDE]: 'my-type',
  foo: 'baz',
  bar: 42,
  deserialized: false,
});
console.log(MyProtocol.deserialize(serialized).value);
// {
//   [SERDE]: 'my-type',
//   foo: 'baz',
//   bar: 42,
//   deserialized: true,
// }
```

## `SerdeProtocol<T>`
You may choose to implement `SerdeProtocol` directly. This variant grants absolute control over the de/serialization algorithms in place. It is more appropriate, for example, for tabular or schematic data formats, as you can pad and align data within a row for predictable navigation within the binary data without the need to deserialize everything first.

Implementing a `SerdeProtocol` requires implementing its `serialize` and `deserialize` methods. Below shows my code for the implementation of `SerdeProtocol<number>`.

Once implemented, call `protocol.register(name)` on an instance of your protocol to register it with *serde*. You may also forcefully override an existing protocol by passing `true` as second parameter.

**Example**

```typescript
import { DeserializeResult, SerdeProtocol } from '@kiruse/serde'

;(new class extends SerdeProtocol<number> {
  serialize(value: number): Uint8Array {
    const buffer = new Uint8Array(8);
    new DataView(buffer.buffer).setFloat64(0, value, true);
    return buffer;
  }
  
  deserialize(buffer: Uint8Array, offset = 0): DeserializeResult<number> {
    return {
      value: new DataView(buffer.buffer, offset).getFloat64(0, true),
      length: 8,
    };
  }
}).register('number');
```

Note that this example is written in TypeScript and respective transformations may apply depending on your target runtime environment.

This is a simple, context-less protocol. Depending on your needs, you may create protocols dependent on some external state.

## Buffer Protocol
Note that because this library is also intended to be run in the browser, but `Buffer` is typically a NodeJS-exclusive type, you must manually import its `SerdeProtocol`. You can either import it for side effects, or for its default export, depending on your needs:

```typescript
import '@kiruse/serde'

// or

import BufferSerde from '@kiruse/serde'
```
