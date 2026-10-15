import { bindNativeReadingOwners, type NativeReadingOwners } from './native-reading-owners.js';
import { bindReadingPaintOwners, type ReadingPaintOwners } from '../paint/reading-owners.js';
import { NativeReadingSceneError } from '../layout/reading-scene-error.js';
import type { readingPaintHooks } from '../paint/reading-hooks.js';
import { readingPageAdmission, assertReadingPageImages } from '../paint/native-reading-page-admission.js';
import type { readingHooks } from './reading-hooks.js';
import { acquireNativeReadingWordBreaking } from '../native-reading-word-breaking.js';
import { acquireNativeReadingPictureBullet } from '../native-reading-picture-bullet.js';
import { nativeReadingRequests, hasNativeReadingRequests, nativeReadingNotices, retainedReadingNotices } from '../native-reading-notice.js';
import { nativeReadingOccurrenceIds, appendNativeReadingScenes, acquireRequestedNativeReadingScenes } from '../layout/native-reading-paragraph.js';
import { nativeReadingAnchorRuns, composeNativeReadingAnchorRun } from '../layout/native-reading-anchor-run.js';
import { nativeReadingRequiresFreshColumn } from '../layout/native-reading-admission.js';
import { nativeReadingImageFrame } from '../layout/native-reading-image-frame.js';
import { assertNativeReadingImageBinding } from '../paint/native-reading-image-availability.js';

/** Install into the calling renderer before source normalization, including
 * every cold/reinitialized worker. Required owners prevent default geometry,
 * layout and resource-session implementations entering the opaque sidecar.
 * Activation is explicit because the package is sideEffects:false.
 * Reinstallation replaces stateless bindings only; no document is retained. */
export function installNativeReadingWorkerRuntime(target: {
  readonly readingHooks: typeof readingHooks;
  readonly readingPaintHooks: typeof readingPaintHooks;
  readonly owners: NativeReadingOwners;
  readonly paintOwners: ReadingPaintOwners;
}): void {
  bindNativeReadingOwners(target.owners);
  bindReadingPaintOwners(target.paintOwners);
  Object.assign(target.readingHooks, {
    error: (blocker, message) => new NativeReadingSceneError(blocker, message),
    wordBreaking: acquireNativeReadingWordBreaking,
    pictureBullet: acquireNativeReadingPictureBullet,
    requests: nativeReadingRequests,
    requested: hasNativeReadingRequests,
    notices: nativeReadingNotices,
    retainNotices: retainedReadingNotices,
    occurrences: nativeReadingOccurrenceIds,
    appendScenes: appendNativeReadingScenes,
    scenes: acquireRequestedNativeReadingScenes,
    anchorRuns: nativeReadingAnchorRuns,
    composeAnchorRun: composeNativeReadingAnchorRun,
    freshColumn: nativeReadingRequiresFreshColumn,
    imageFrame: nativeReadingImageFrame,
  } satisfies typeof readingHooks);

  Object.assign(target.readingPaintHooks, {
    pageAdmission: readingPageAdmission, assertPageImages: assertReadingPageImages,
    assertNativeReadingImageBinding,
  } satisfies typeof readingPaintHooks);
}
