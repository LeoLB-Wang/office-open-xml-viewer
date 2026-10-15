import { noReadingNotices, noNativeReadingRequests, type DocxReadingNotice, type NativeReadingRequests } from './internal/reading-contract.js';
export { noReadingNotices, noNativeReadingRequests, type DocxReadingNotice, type NativeReadingRequests } from './internal/reading-contract.js';
import type { DeepReadonly, DocumentLayout, LayoutPage } from './layout/types.js';
import type { LayoutSourceStore } from './layout/layout-source-store.js';
import { nativeReadingOwners } from './internal/native-reading-owners.js';
import { nativeReadingOccurrenceIds } from './layout/native-reading-paragraph.js';
import { readingPictureBulletKeys } from './paint/reading-picture-bullets.js';
export { readingPictureBulletKeys } from './paint/reading-picture-bullets.js';

const canonicalNotices: readonly DocxReadingNotice[] = Object.freeze([
  Object.freeze({ code: 'DRAWINGS_RELOCATED_FOR_READING' as const,
    message: 'Some drawings were moved into separate blocks for readability' }),
  Object.freeze({ code: 'INACTIVE_PICTURE_DATA_RETAINED' as const,
    message: 'Inactive picture formatting was retained as metadata without interpretation' }),
  Object.freeze({ code: 'WORD_BREAKING_SIMPLIFIED_FOR_READING' as const,
    message: 'Word breaking is simplified for readability; line and page breaks may differ' }),
  Object.freeze({ code: 'PICTURE_BULLETS_SIZED_FOR_READING' as const,
    message: 'Picture bullets use stored image sizes for reading; their appearance, placement and page breaks may differ from Word' }),
]);

// Successful complete source acquisition is invariant for this sealed store.
// Cache by its factory-owned identity, never by mutable public models, variants
// or a caller-supplied adapter. Failed scans leave no partially acquired entry.
const requestsBySource = new WeakMap<LayoutSourceStore, NativeReadingRequests>();
export function nativeReadingRequests(source: LayoutSourceStore): NativeReadingRequests {
  const cacheable = nativeReadingOwners.isLayoutSourceStore(source);
  const retained = cacheable ? requestsBySource.get(source) : undefined;
  if (retained) return retained;
  let contour = false, wordBreaking = false, pictureBullets = false;
  for (const ref of source.blocks.sources) {
    const block = source.blocks.resolve(ref);
    if (block.type !== 'paragraph') continue;
    contour ||= nativeReadingOccurrenceIds(block).length !== 0;
    wordBreaking ||= block.nativeReadingNumberingWordBreaking !== undefined
      || block.runs.some(run => (run.type === 'text' || run.type === 'field')
        && run.nativeReadingWordBreaking !== undefined);
    pictureBullets ||= block.nativeReadingPictureBullet !== undefined;
  }
  const result = Object.freeze({ contour, wordBreaking, pictureBullets });
  if (cacheable) requestsBySource.set(source, result);
  return result;
}
export function hasNativeReadingRequests(source: LayoutSourceStore): boolean {
  const requests = nativeReadingRequests(source);
  return requests.contour || requests.wordBreaking || requests.pictureBullets;
}
export function pageHasNativeReadingScenes(page: LayoutPage | DeepReadonly<LayoutPage>): boolean {
  return page.layers.body.some(node => node.kind === 'paragraph' && (node.nativeReadingRelocations?.length ?? 0) > 0);
}
export function nativeReadingNotices(
  layout: DocumentLayout | DeepReadonly<DocumentLayout>,
  requests: NativeReadingRequests = noNativeReadingRequests,
): readonly DocxReadingNotice[] {
  const notices: DocxReadingNotice[] = [];
  if (layout.pages.some(pageHasNativeReadingScenes)) {
    notices.push(canonicalNotices[0]!);
    if (layout.pages.some(page => page.layers.body.some(node =>
      node.kind === 'paragraph' && node.nativeReadingInactivePictureData === true))) notices.push(canonicalNotices[1]!);
  }
  if (requests.wordBreaking && layout.pages.length > 0) notices.push(canonicalNotices[2]!);
  if (requests.pictureBullets && layout.pages.some(page => readingPictureBulletKeys(page).length > 0))
    notices.push(canonicalNotices[3]!);
  return notices.length === 0 ? noReadingNotices : Object.freeze(notices);
}

export { updateNativeReadingNotice } from './internal/reading-hooks.js';

/** Normalize worker disclosures to a closed, immutable canonical subset.
 * Inactive picture metadata is disclosed only with an actual relocation. */
export function retainedReadingNotices(value: readonly DocxReadingNotice[] | undefined): readonly DocxReadingNotice[] {
  if (value === undefined) return noReadingNotices;
  if (!Array.isArray(value)) throw new TypeError('Invalid reading-layout disclosure');
  if (value.length === 0) return noReadingNotices;
  const retained: DocxReadingNotice[] = [];
  let previous = -1;
  for (const notice of value) {
    const index = canonicalNotices.findIndex(candidate => notice !== null && typeof notice === 'object'
      && notice.code === candidate.code && notice.message === candidate.message);
    if (index <= previous || index < 0 || (index === 1 && previous !== 0))
      throw new TypeError('Invalid reading-layout disclosure');
    retained.push(canonicalNotices[index]!);
    previous = index;
  }
  return Object.freeze(retained);
}
