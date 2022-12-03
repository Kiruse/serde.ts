# serde.ts
*serde* defines an API for binary **ser**ialization & **de**serialization of arbitrary data types. It differs vastly from JSON and BSON in that it is implemented through `SerdeProtocol`s for few main advantages:

- A protocol can integrate any type with the API, even third party types,
- Serialized values can be deserialized appropriately, and
- Automatic recursive deserialization of class-less types allows types to deserialize type-safely (for TypeScript).

*serde* exposes the methods `serialize`, `deserialize`, `serializeAs`, `deserializeAs` as well as `SerdeProtocol<T>`. Most commonly, you will be using `serialize` and `deserialize`.

When TypeScript's decorators feature matures, serde will use these to deliver an even easier developer experience.

***IMPORTANT:** This library is an early WIP. API may and will change as it matures.*

## Quickstart
If your project has simple needs for serialization & deserialization, e.g. cross-session persistence, *serde* can get you started quickly.
If your data type has no specific needs and consists only of [standard types](https://kiruse.gitbook.io/serde.ts/standard-types), *serde* works out of the box:

```typescript
import SerdeProtocol from '@kiruse/serde';
import { expect } from 'chai';

const serde = SerdeProtocol.standard();

const ref = {
    foo: 'foo',
    bar: 42,
    baz: 69,
};
const bytes = serde.serialize(ref);
expect(serde.deserialize(bytes)).to.deep.equal(ref);
```

If your object has more specific needs, such as class methods or computed properties, you may/should use the `.derive` method:

```typescript
import SerdeProtocol, { SERDE } from '@kiruse/serde';
import { expect } from 'chai';

class MyType {
    [SERDE] = 'my-type';
    
    constructor(
        public readonly foo: number,
        public readonly bar: string,
        private deserialized = false,
    ) {}
    
    get isDeserialized() { return this.deserialized }
}

const serde = SerdeProtocol.standard()
    .derive(
        'my-type',
        (myType: MyType) => ({ foo: myType.foo, bar: myType.bar }),
        (data) => new MyType(data.foo, data.bar, true);
    );

const ref = new MyType(42, 'baz');
const bytes = serde.serialize(ref);
expect(serde.deserialize(bytes)).to.deep.equal(ref);
```

For more complex needs, you may also use the `.sub` method:

```typescript
import SerdeProtocol, { SERDE } from '@kiruse/serde';
import { expect } from 'chai';

class MyType {
    [SERDE] = 'my-type';
    
    constructor(
        public readonly foo: string,
        public readonly bar: number,
    ) {}
}

const serde = SerdeProtocol.standard()
    .sub('my-type',
        (ctx, writer, myType: MyType) => {
            ctx.serde.serializeAs('string', myType.foo, writer, ctx);
            ctx.serde.serializeAs('number', myType.bar, writer, ctx);
        },
        (ctx, reader): MyType => {
            const foo = ctx.serde.deserializeAs('string', reader, ctx);
            const bar = ctx.serde.deserializeAs('number', reader, ctx);
            return new MyType(foo, bar);
        },
    );

const myType = new MyType('baz', 42);
const bytes = serde.serializeAs('my-type', myType).compress().buffer;
expect(serde.deserializeAs('my-type', bytes)).to.deep.equal(myType);
```

Note that there is some peculiarity to `SerdeProtocol`'s `.sub` and `.derive` methods: while they alter the object's internal data directly, the returned data type differs from the original. Thus, in order to retain proper type information, you must either reassign `serde`, or chain these methods. More on this at [`.sub` & `.derive` methods](https://kiruse.gitbook.io/serde.ts/internals/type-map#.sub-and-.derive-methods).

Alternatively, the library also offers the `SerdeBase` class which underlies the `SerdeProtocol` but relies on a different usage.

Find the full documentation [here](https://kiruse.gitbook.io/serde.ts/).

## Caveats
It is impossible to de/serialize neither symbols nor functions:

While technically possible, deserializing **functions** (which includes constructors) would create duplicates as we cannot reference the original function without another global registry. Further, the prototype model would render this code highly complex. Further further, built-in/native functions cannot be de/serialized regardless. Finally, it poses an extreme security risk of code injection which should be avoided at all costs.

**Symbols** can technically be de/serialized, but as Symbols are unique at runtime, deserializing would again create incompatible duplicates. It would be possible to support through another registry, but this would once again require associating them with less unique strings, defeating the absolute uniqueness of symbols. In other words, two symbols can share the same display text. You can create your own `Symbol('SERDE')` symbol and it would still be unique from this library's `SERDE` symbol, thus not usable to specify the `SerdeProtocol`.
