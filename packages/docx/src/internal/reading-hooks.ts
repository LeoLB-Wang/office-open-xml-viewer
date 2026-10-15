import { noReadingNotices, noNativeReadingRequests, type DocxReadingNotice } from './reading-contract.js';
export { noReadingNotices, noNativeReadingRequests, type DocxReadingNotice, type NativeReadingRequests } from './reading-contract.js';
interface ReadingHooks {
  error: (blocker: import('../layout/reading-scene-error.js').NativeReadingSceneBlocker, message: string) => Error;
  wordBreaking: typeof import('../native-reading-word-breaking.js').acquireNativeReadingWordBreaking;
  pictureBullet: typeof import('../native-reading-picture-bullet.js').acquireNativeReadingPictureBullet;
  requests: typeof import('../native-reading-notice.js').nativeReadingRequests;
  requested: typeof import('../native-reading-notice.js').hasNativeReadingRequests;
  notices: typeof import('../native-reading-notice.js').nativeReadingNotices;
  retainNotices: typeof import('../native-reading-notice.js').retainedReadingNotices;
  occurrences: typeof import('../layout/native-reading-paragraph.js').nativeReadingOccurrenceIds;
  appendScenes: typeof import('../layout/native-reading-paragraph.js').appendNativeReadingScenes;
  scenes: typeof import('../layout/native-reading-paragraph.js').acquireRequestedNativeReadingScenes;
  anchorRuns: typeof import('../layout/native-reading-anchor-run.js').nativeReadingAnchorRuns;
  composeAnchorRun: typeof import('../layout/native-reading-anchor-run.js').composeNativeReadingAnchorRun;
  freshColumn: typeof import('../layout/native-reading-admission.js').nativeReadingRequiresFreshColumn;
  imageFrame: typeof import('../layout/native-reading-image-frame.js').nativeReadingImageFrame;
}

/** Internal selected-source strategy, installed once per renderer realm
 * before source acquisition. Only stateless functions are retained: document
 * policies and archive/resource ownership remain with acquired source facts.
 * OOXML consumers retain empty defaults and fail-closed admission guards;
 * installing a source never changes the interpretation of ordinary OOXML. */
function unavailable(): never { throw new Error('Reading source runtime is not initialized'); }
const emptyOccurrences: readonly string[] = Object.freeze([]);
export const readingHooks: ReadingHooks = {
  wordBreaking: value => value === undefined ? undefined : unavailable(),
  pictureBullet: numbering => numbering?.__nativeReadingPictureBullet === undefined ? undefined : unavailable(),
  requests: () => noNativeReadingRequests,
  requested: () => false,
  notices: () => noReadingNotices,
  retainNotices: value => value === undefined || (Array.isArray(value) && value.length === 0)
    ? noReadingNotices : unavailable(),
  occurrences: () => emptyOccurrences,
  anchorRuns: () => new Map(),
  appendScenes: unavailable,
  scenes: unavailable,
  composeAnchorRun: unavailable,
  freshColumn: unavailable,
  imageFrame: unavailable,
  error: unavailable,
};

export function installReadingHooks(hooks: ReadingHooks): void { Object.assign(readingHooks, hooks); }

/** One stable live region for the complete active disclosure set. */
export function updateNativeReadingNotice(container: HTMLElement, current: HTMLElement | null, notices: readonly DocxReadingNotice[]): HTMLElement | null {
  if (notices.length === 0) { current?.remove(); return null; }
  const element = current ?? container.ownerDocument.createElement('div');
  element.setAttribute('role', 'status'); element.setAttribute('aria-live', 'polite');
  const message = notices.map(notice => notice.message).join(' ');
  if (element.textContent !== message) element.textContent = message;
  if (!current) container.insertBefore(element, container.firstChild);
  return element;
}
