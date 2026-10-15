import { nativeReadingOwners } from './native-reading-owners.js';
import { readingPaintOwners } from '../paint/reading-owners.js';
import { NativeReadingSceneError } from '../layout/reading-scene-error.js';
import { readingPaintHooks, installReadingPaintHooks } from '../paint/reading-hooks.js';
import { readingPageAdmission, assertReadingPageImages } from '../paint/native-reading-page-admission.js';
import { readingHooks, installReadingHooks } from './reading-hooks.js';
import { acquireNativeReadingWordBreaking } from '../native-reading-word-breaking.js';
import { acquireNativeReadingPictureBullet } from '../native-reading-picture-bullet.js';
import { nativeReadingRequests, hasNativeReadingRequests, nativeReadingNotices, retainedReadingNotices } from '../native-reading-notice.js';
import { nativeReadingOccurrenceIds, appendNativeReadingScenes, acquireRequestedNativeReadingScenes } from '../layout/native-reading-paragraph.js';
import { nativeReadingAnchorRuns, composeNativeReadingAnchorRun } from '../layout/native-reading-anchor-run.js';
import { nativeReadingRequiresFreshColumn } from '../layout/native-reading-admission.js';
import { nativeReadingImageFrame } from '../layout/native-reading-image-frame.js';
import { assertNativeReadingImageBinding } from '../paint/native-reading-image-availability.js';

/** Called by selected-source entry points before source normalization. Keep
 * activation explicit: the package is sideEffects:false, so a side-effect-only
 * import would disappear from consumer builds. No per-document policy lives
 * in this registry; individual acquired facts still authorize every action.
 * A self-contained worker sidecar binds the renderer's owners and hook targets
 * synchronously before its archive is opened. Normal module graphs share those
 * identities already and omit the target. Reinstallation is idempotent. */
export function installNativeReadingRuntime(target?: {
  readonly readingHooks: typeof readingHooks;
  readonly readingPaintHooks: typeof readingPaintHooks;
  readonly owners: typeof nativeReadingOwners;
  readonly paintOwners: typeof readingPaintOwners;
}): void {
  if (target) {
    Object.assign(nativeReadingOwners, target.owners);
    Object.assign(readingPaintOwners, target.paintOwners);
  }
  installReadingHooks({
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
  });

  installReadingPaintHooks({
    pageAdmission: readingPageAdmission, assertPageImages: assertReadingPageImages,
    assertNativeReadingImageBinding,
  });
  if (target) {
    Object.assign(target.readingHooks, readingHooks);
    Object.assign(target.readingPaintHooks, readingPaintHooks);
  }
}
