import { NativeReadingSceneError } from '../layout/reading-scene-error.js';
import { installReadingPaintHooks } from '../paint/reading-hooks.js';
import { installReadingHooks } from './reading-hooks.js';
import { acquireNativeReadingWordBreaking } from '../native-reading-word-breaking.js';
import { acquireNativeReadingPictureBullet } from '../native-reading-picture-bullet.js';
import { nativeReadingRequests, hasNativeReadingRequests, nativeReadingNotices, retainedReadingNotices } from '../native-reading-notice.js';
import { nativeReadingOccurrenceIds, appendNativeReadingScenes, acquireRequestedNativeReadingScenes } from '../layout/native-reading-paragraph.js';
import { nativeReadingAnchorRuns, composeNativeReadingAnchorRun } from '../layout/native-reading-anchor-run.js';
import { nativeReadingRequiresFreshColumn } from '../layout/native-reading-admission.js';
import { nativeReadingImageFrame } from '../layout/native-reading-image-frame.js';
import { assertNativeReadingImageAvailable, assertNativeReadingImageBinding } from '../paint/native-reading-image-availability.js';

/** Called by selected-source entry points before source normalization. Keep
 * activation explicit: the package is sideEffects:false, so a side-effect-only
 * import would disappear from consumer builds. No per-document policy lives
 * in this registry; individual acquired facts still authorize every action. */
export function installNativeReadingRuntime(): void {
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

  installReadingPaintHooks({ assertNativeReadingImageAvailable, assertNativeReadingImageBinding });
}
