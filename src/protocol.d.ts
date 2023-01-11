import Reader from './reader';
import type { DataObject, DataWrapper, DeserializeContext, DeserializedData, Deserializer, Reference, SerializeContext, Serializer, TypeMap } from './types'
import Writer from './writer';

export type StandardProtocolMap = {
  boolean: boolean,
  number: number,
  string: string,
  bigint: bigint,
  undef: undefined,
  null: null,
  regex: RegExp,
  regexp: RegExp,
  set: Set<unknown>,
  map: Map<unknown, unknown>,
  buffer: Buffer,
  arraybuffer: ArrayBuffer,
  typedarray: ArrayBufferView,
  array: any[],
  object: object,
  'data-object': DataObject<unknown>,
  reference: Reference,
}

type MappedConstructor<Map extends TypeMap> = {
  (): Serde<Map>;
  <Ctx>(ctx: Ctx | ((serde: Serde<Map, Ctx>) => Ctx)): Serde<Map, Ctx>;
}

type Serde<Map extends TypeMap, Ctx = {}> =
  {
    ctx: Ctx;
    
    getSubprotocolOf(value: any): string;
    
    serialize(
      value: Map[keyof Map],
      writer?: Writer,
      ctx?: SerializeContext<Map, Ctx>,
    ): Uint8Array;
    
    serializeAs<P extends keyof Map = keyof Map>(
      subprotocol: P,
      value: Map[P],
      writer?: Writer,
      ctx?: SerializeContext<Map, Ctx>,
    ): Writer;
    
    deserialize(bytes: Uint8Array): any;
    deserialize(reader: Reader, ctx?: DeserializeContext<Map, Ctx>): any;
    
    deserializeAs<P extends keyof Map = keyof Map>(
      subprotocol: P,
      source: Uint8Array | Reader,
      ctx?: DeserializeContext<Map, Ctx>,
    ): Map[P];
    
    set<P extends keyof Map = keyof Map>(
      subprotocol: P,
      serialize: Serializer<Map[P], Map, Ctx>,
      deserialize: Deserializer<Map[P], Map, Ctx>,
      force?: boolean,
    ): Serde<Map, Ctx>;
    
    setSimple<P extends keyof Map = keyof Map, D = any>(
      subprotocol: P,
      filter: (value: Map[P], data: DataWrapper) => D,
      rebuild: (data: DeserializedData<D>, deref: DeserializeContext['deref']) => Map[P],
      force?: boolean
    ): Serde<Map, Ctx>;
  }
  & (
    Map extends StandardProtocolMap
    ? {
        standard<This>(this: This): This;
      }
    : {}
  )

type SerdeAlter<Map extends TypeMap, Ctx = {}> = Omit<Serde<Map, Ctx>, 'set' | 'setSimple'> & {
  set<T, P extends string>(
    subprotocol: P,
    serialize: Serializer<T, any, Ctx>,
    deserialize: Deserializer<T, any, Ctx>,
    force?: boolean,
  ): SerdeAlter<Map & { [p in P]: T }, Ctx>;
  
  setSimple<T, P extends string, D>(
    subprotocol: P,
    filter: (value: T, data: DataWrapper) => D,
    rebuild: (data: DeserializedData<D>, deref: DeserializeContext['deref']) => T,
    force?: boolean,
  ): SerdeAlter<Map & { [p in P]: T }, Ctx>;
}

interface SerdeConstructor {
  <M extends TypeMap = StandardProtocolMap>(): Serde<M>;
  <M extends TypeMap, Ctx>(ctx: Ctx | ((serde: Serde<M, Ctx>) => Ctx)): Serde<M, Ctx>;
  new <M extends TypeMap>(): Serde<M>;
  new <M extends TypeMap, Ctx>(ctx: Ctx | ((serde: Serde<M, Ctx>) => Ctx)): Serde<M, Ctx>;
  
  Mapped<M extends TypeMap>(): MappedConstructor<M>;
  
  /** Measure the performance of various points of interest using the `Performance` API. Depends on the global
   * `performance` variable. If not defined, does nothing.
   */
  measurePerformance(): void;
}

interface SerdeAlterConstructor {
  <M extends TypeMap = StandardProtocolMap>(): SerdeAlter<M>;
  <Ctx>(ctx: Ctx | ((serde: SerdeAlter<any, Ctx>) => Ctx)): SerdeAlter<StandardProtocolMap, Ctx>;
  <M extends TypeMap, Ctx>(ctx: Ctx | ((serde: SerdeAlter<any, Ctx>) => Ctx)): SerdeAlter<M, Ctx>;
  new <M extends TypeMap = StandardProtocolMap>(): SerdeAlter<M>;
  new <Ctx>(ctx: Ctx | ((serde: SerdeAlter<any, Ctx>) => Ctx)): SerdeAlter<StandardProtocolMap, Ctx>;
  new <M extends TypeMap, Ctx>(ctx: Ctx | ((serde: SerdeAlter<any, Ctx>) => Ctx)): SerdeAlter<M, Ctx>;
}

declare const Serde: SerdeConstructor;
export default Serde;

export declare const SerdeBase: SerdeConstructor;
export declare const SerdeAlter: SerdeAlterConstructor;
