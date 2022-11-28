# serde.ts
*serde* defines an API for binary **ser**ialization & **de**serialization of arbitrary data types. It differs vastly from JSON and BSON in that it is implemented through `SerdeProtocol`s for few main advantages:

- A protocol can integrate any type with the API, even third party types,
- Serialized values can be deserialized appropriately, and
- Automatic recursive deserialization of class-less types allows types to deserialize type-safely (for TypeScript).

*serde* exposes the methods `serialize`, `deserialize`, `serializeAs`, `deserializeAs` as well as `SerdeProtocol<T>`. Most commonly, you will be using `serialize` and `deserialize`.

When TypeScript's decorators feature matures, serde will use these to deliver an even easier developer experience.

***IMPORTANT:** This library is an early WIP. API may and will change as it matures.*

## Table of Contents
- [serde.ts](#serdets)
  - [Table of Contents](#table-of-contents)
  - [Usage](#usage)
  - [Simple SerDe](#simple-serde)
  - [Circular Reference Resolution](#circular-reference-resolution)
  - [Caveats](#caveats)

## Usage
*serde* default-exports the `SerdeProtocol`, which acts like a micro-cosmos of de/serialization subprotocols. Typically, a single such instance will suffice, but it is possible to override the default behavior and fully customize the entire pipeline - though at some point one loses all benefit of using this library altogether.

**Example**
```typescript
import SerdeProtocol, { SERDE } from '@kiruse/serde'
import { expect } from 'chai'

class MyType {
  [SERDE] = 'my-type';
  
  constructor(
    public someNumber = 42,
    public someString = 'foobar',
  ) {}
}

const serde = SerdeProtocol.standard()
  .sub('my-type',
    (ctx, writer, value: MyType) => {
      writer.writeNumber(value.someNumber);
      writer.writeString(value.someString);
    },
    (ctx, reader) => {
      return {
        [SERDE]: 'my-type',
        someNumber: reader.readNumber(),
        someString: reader.readString(),
      }
    },
  );

const myType1 = new MyType();
const myType2 = new MyType(69, 'barfoo');

const serialized1 = serde.serialize(myType1);
const serialized2 = serde.serializeAs(myType2);

expect(serde.deserialize(serialized1)).to.deep.equal(myType1);
expect(serde.deserializeAs(serialized2)).to.deep.equal(myType2);
```

There is a difference between `serialize` and `serializeAs`, as well as their deserialization counterparts: `serialize` and `deserialize` resort to `any` and `unknown` respectively, whereas `serializeAs` and `deserializeAs` are fully typed. The type information is extracted from the call to `sub` (and assumes serializer & deserializer use the same type as input/output), and associated with the protocol name (in the above example `my-type`). In other words, `serialized1 is unknown`, whereas `serialized2 is MyType`.

Calling `SerdeProtocol.standard()` creates a new `SerdeProtocol` with default implementations for various built-in types, such as Buffers, ArrayBuffers, and TypedArrays. One may pass a derived `SerdeProtocol` to populate *it* with the standard implementations instead, e.g. `SerdeProtocol.standard(new MySerdeProtocol())`. This is to allow customizing the `SerdeProtocol.getSubProtocolOf()` member method, which integrates built-in types with *serde* through specific rules.

## Simple SerDe
If your needs for de/serialization are not very specific, you may simply create a derived standard object protocol:

```typescript
import { SerdeProtocol, SERDE } from '@kiruse/serde'

class MyType {
  [SERDE] = 'my-type';
  
  constructor(
    public someNumber = 42,
    public someString = 'foobar',
  ) {}
}

const serde = SerdeProtocol.standard()
  .derive('my-type',
    (val: MyType) => ({ num: val.someNumber, str: val.someString }),
    data => new MyType(data.num, data.str),
  )
```

The `derive` method takes a `filter` and a `rebuild` callback. `filter` is expected to derive a simplified, data-only version of the input object, which can be fed back to `rebuild` to reconstruct a valid instance of the underlying type. The generated subprotocol relies on the `object` subprotocol to de/serialize this data-only object.

## Circular Reference Resolution
In order to resolve circular references, the `standard` protocol serializes nested objects by reference, and each reference is stored sequentially in the underlying binary buffer. However, *serde* is not magic, and I want to leave enough room for full control, so `standard` only considers objects stored in the `ctx.refs` property of the first argument `ctx` passed to the serializer callbacks. Then, when calling `SerdeProtocol.serialize`, any value serialized with `object` is serialized as `reference` instead - save for the root object itself. This requires that the `ctx` argument be passed down to `serialize`. Note that this does not apply when calling `serializeAs` directly.

## Caveats
It is impossible to de/serialize neither symbols nor functions:

While technically possible, deserializing **functions** (which includes constructors) would create duplicates as we cannot reference the original function without another global registry. Further, the prototype model would render this code highly complex. Further further, built-in/native functions cannot be de/serialized regardless. Finally, it poses an extreme security risk of code injection which should be avoided at all costs.

**Symbols** can technically be de/serialized, but as Symbols are unique at runtime, deserializing would again create incompatible duplicates. It would be possible to support through another registry, but this would once again require associating them with less unique strings, defeating the absolute uniqueness of symbols. In other words, two symbols can share the same display text. You can create your own `Symbol('SERDE')` symbol and it would still be unique from this library's `SERDE` symbol, thus not usable to specify the `SerdeProtocol`.
