import type { DeepReadonly, LayoutPage } from '../layout/types.js';
import { readingPictureBulletKeys } from './reading-picture-bullets.js';
import { assertNativeReadingImageAvailable } from './native-reading-image-availability.js';
import { isUnavailablePaintResourceHandle, type PaintResourceSession } from './resource-session.js';

type ReadingPage = LayoutPage | DeepReadonly<LayoutPage>;
interface ReadingPageAdmission { readonly pictureBulletKeys: readonly string[] }

/** Library reading policy: changed placement requires complete image ownership
 * before publication. Ordinary pages retain background-before-error behavior.
 * Inspect retained identities only; shared shape planning stays in layout. */
export function readingPageAdmission(page: ReadingPage): ReadingPageAdmission | undefined {
  const pictureBulletKeys = readingPictureBulletKeys(page);
  return pictureBulletKeys.length !== 0 || page.layers.body.some(node =>
    node.kind === 'paragraph' && (node.nativeReadingRelocations?.length ?? 0) > 0)
    ? { pictureBulletKeys } : undefined;
}

/** Decoded admission precedes the single synchronous clear-and-paint section. */
export function assertReadingPageImages(
  session: PaintResourceSession, page: ReadingPage, admission: ReadingPageAdmission,
): void {
  for (const node of page.layers.body) {
    if (node.kind !== 'paragraph' || !node.nativeReadingRelocations?.length) continue;
    for (const id of node.nativeReadingRelocations) {
      const drawing = node.drawings.find(candidate => candidate.id === id);
      if (!drawing) throw new Error('Reading page lost a complete drawing');
      for (const command of drawing.commands) {
        if (command.kind !== 'resource') continue;
        if (command.resourceKind !== 'image') throw new Error('Reading scene changed its resource class');
        if (!command.nativeImagePlan || command.nativeImagePlan.source.resourceKey !== command.resourceKey
          || command.orientation !== undefined) throw new Error('Reading image lost its acquired projection');
        assertNativeReadingImageAvailable(session, command.nativeImagePlan, command.rect);
      }
    }
  }
  // Reading publication cannot replace a missing owned image with an
  // optional-codec placeholder or silently paint nothing. Verify every
  // selected marker before clearing the caller's existing surface.
  for (const key of admission.pictureBulletKeys) {
    const resource = session.resolve(key, 'picture-bullet');
    if (isUnavailablePaintResourceHandle(resource.handle)) {
      throw new Error('Reading picture bullet has no decoded owned image');
    }
  }
}
