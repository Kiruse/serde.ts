# serde.ts

Please find the full documentation over at [GitBook](https://kiruse.gitbook.io/serde.ts/).

## Quickstart
If your project has simple needs for serialization & deserialization, e.g. cross-session persistence, serde can get you started quickly.
If your data type has no specific needs and consists only of standard types, serde works out of the box:

```typescript
import Serde from '@kiruse/serde';
import { expect } from 'chai';
​
const serde = Serde().standard();
​
const ref = {
    foo: 'foo',
    bar: 42,
    baz: 69,
};
const bytes = serde.serialize(ref);
expect(serde.deserialize(bytes)).to.deep.equal(ref);
serde supports references, including cyclic references, and will reconstruct an object with identical hierarchy than your input:
import Serde from '@kiruse/serde';
​
const serde = Serde().standard();
​
// self-referential object
const ref: any = {};
ref.ref = ref;
​
const value = serde.deserialize(serde.serialize(ref));
value === value.ref;
```

## setSimple Method
The Serde protocol is highly customizeable to various degrees. Indicative of its name, the `Serde.prototype.setSimple` method allows some more control than serializing plain old objects:

```typescript
import Serde, { SERDE, StandardProtocolMap } from '@kiruse/serde';
import { expect } from 'chai';
​
type MyProtocolMap = StandardProtocolMap & {
    'my-foo': Foo;
}
​
class Foo {
    [SERDE] = 'my-foo' as const;
    constructor(public readonly id: number) {}
}
​
const serde = Serde<MyProtocolMap>().standard()
    .setSimple('my-foo',
        (foo: Foo) => foo.id,
        (id: Foo['id']) => new Foo(id),
    );
```

However, there is a caveat: due to the way *serde* internally handles references you only have direct access to first-level properties, i.e. you cannot access nested objects. *serde* promises that these special references are resolved and the object properly reconstructed after the call to deserialize. Within the deserialization process, certain rules must be considered. Read further at 
​
## set Method
Save for writing your own protocol, the highest degree of control is offered by the `Serde.prototype.set` method which grants you access to the Writer and Reader used during de/serialization as well as their contexts:

```typescript
import Serde, { SERDE, StandardProtocolMap } from '@kiruse/serde';
​
type MyProtocolMap = StandardProtocolMap & {
    'my-foo': Foo;
}
​
class Foo {
    [SERDE] = 'my-foo' as const;
    constructor(public readonly id: number) {}
}
​
const serde = Serde().standard()
    .set('my-foo',
        (ctx, writer, foo: Foo) => {
            writer.writeUint32(foo.id);
        },
        (ctx, reader) => {
            return new Foo(reader.readUint32());
        },
    );
```

## Caveats
It is impossible to de/serialize neither symbols nor functions:

While technically possible, deserializing **functions** (which includes constructors) would create duplicates as we cannot reference the original function without another global registry. Further, the prototype model would render this code highly complex. Further further, built-in/native functions cannot be de/serialized regardless. Finally, it poses an extreme security risk of code injection which should be avoided at all costs.

**Symbols** can technically be de/serialized, but as Symbols are unique at runtime, deserializing would again create incompatible duplicates. It would be possible to support through another registry, but this would once again require associating them with less unique strings, defeating the absolute uniqueness of symbols. In other words, two symbols can share the same display text. You can create your own `Symbol('SERDE')` symbol and it would still be unique from this library's `SERDE` symbol, thus not usable to specify the `SerdeProtocol`.
