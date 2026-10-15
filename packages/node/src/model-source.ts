import { parseTypedParserError } from '@silurus/ooxml-core/worker';
import {
  beginModelSourceLoad,
  openModelSourceModule,
  selectModelSource,
  type ModelSource,
  type ModelSourceTarget,
  type OpenedModelSourceModule,
} from '@silurus/ooxml-core/internal/model-source';
import { resolveOoxmlContainer } from '@silurus/ooxml-core';

/** One Node input: an opened model-source archive, or resolved OOXML bytes. */
export type NodeSessionInput<TArchive> =
  | Readonly<{ kind: 'model-source'; opened: OpenedModelSourceModule<TArchive>; sourceByteLength: number }>
  | Readonly<{ kind: 'ooxml'; bytes: Uint8Array }>;

/**
 * Resolve a Node session input. The first configured model source that claims
 * the raw bytes opens them in this realm; otherwise the bytes are resolved as
 * an OOXML container (decrypting an Agile-encrypted package with `password`).
 * Without `modelSources` nothing is imported and the OOXML path is unchanged.
 */
export async function resolveNodeSessionInput<TArchive>(
  buffer: ArrayBuffer | Uint8Array,
  target: ModelSourceTarget,
  options: Readonly<{
    modelSources?: readonly ModelSource[];
    password?: string;
    signal?: AbortSignal;
  }>,
  validateArchive: (archive: unknown) => TArchive,
): Promise<NodeSessionInput<TArchive>> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const selected = options.modelSources === undefined
    ? undefined
    : selectModelSource(options.modelSources, target, bytes);
  if (!selected) {
    return { kind: 'ooxml', bytes: await resolveOoxmlContainer(bytes, options.password) };
  }
  const load = beginModelSourceLoad(selected, target);
  try {
    const opened = await openModelSourceModule(
      load.module,
      bytes,
      validateArchive,
      options.signal,
      load.transfer,
    );
    try {
      load.release();
    } catch (error) {
      try { opened.close(); } catch {}
      throw error;
    }
    return {
      kind: 'model-source',
      opened: {
        ...opened,
        archive: normalizeSourceArchive(opened.archive),
        close() {
          try { opened.close(); } catch (error) { throw parseTypedParserError(error) ?? error; }
        },
      },
      sourceByteLength: bytes.byteLength,
    };
  } catch (error) {
    throw parseTypedParserError(error) ?? error;
  } finally {
    load.release();
  }
}

/** Browser workers normalize declared failures when serializing their responses.
 * Node has no wire boundary, so guard lazy source calls here, once for every
 * format. Native receivers and immutable archive methods remain supported. */
function normalizeSourceArchive<T>(raw: T): T {
  const target = raw as object;
  return new Proxy(Object.create(target) as object, {
    get(_facade, key) {
      try {
        const value = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          try { return Reflect.apply(value, target, args); }
          catch (error) { throw parseTypedParserError(error) ?? error; }
        };
      } catch (error) { throw parseTypedParserError(error) ?? error; }
    },
  }) as T;
}
