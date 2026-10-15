import { GeometryWorkBudgetError } from '@silurus/ooxml-core';
import { isDeepFrozenPlainDataRoot, snapshotPlainData } from '../layout/plain-data.js';
import { isLayoutSourceStore } from '../layout/layout-source-store.js';
import { planRetainedAnchorShape } from '../layout/retained-anchor-shape.js';

/** A URL-loaded, self-contained worker sidecar has its own module instances.
 * Reading must use the renderer's seals, registry identities and shared shape
 * planner, rather than accepting lookalikes or creating sidecar-owned layouts.
 * Bind these stateless operations before acquisition; retain no document here.
 * Browser/Node module graphs already share these owners and use the defaults. */
export const nativeReadingOwners = {
  isDeepFrozenPlainDataRoot,
  snapshotPlainData,
  isLayoutSourceStore,
  planRetainedAnchorShape,
  GeometryWorkBudgetError,
};
