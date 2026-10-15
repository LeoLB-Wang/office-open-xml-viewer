import { installNativeReadingWorkerRuntime } from './native-reading-worker-runtime.js';
import { readingDefaultOwners } from './reading-default-owners.js';
import { readingHooks } from './reading-hooks.js';
import { readingPaintHooks } from '../paint/reading-hooks.js';
import { isOwnedPaintResourceSession, isUnavailablePaintResourceHandle } from '../paint/resource-session.js';
import { imageNaturalSize } from '@silurus/ooxml-core';

/** Browser/Node selected-source graphs share module instances with rendering.
 * Keep their default initialization out of the URL-loaded worker sidecar. */
export function installNativeReadingRuntime(): void {
  installNativeReadingWorkerRuntime({
    readingHooks, readingPaintHooks, owners: readingDefaultOwners,
    paintOwners: { isOwnedPaintResourceSession, isUnavailablePaintResourceHandle, imageNaturalSize },
  });
}
