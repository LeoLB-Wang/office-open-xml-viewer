import { GeometryWorkBudgetError, drawingMLGeometryBounds, requireResolvedDrawingMLGeometry, imagePaintProjection } from '@silurus/ooxml-core';
import { isDeepFrozenPlainDataRoot, snapshotPlainData } from '../layout/plain-data.js';
import { isLayoutSourceStore } from '../layout/layout-source-store.js';
import { planRetainedAnchorShape } from '../layout/retained-anchor-shape.js';
import { retainedAnchorChildFrame } from '../layout/retained-anchor-child-frame.js';
import { translateDrawing, translateParagraphLayout } from '../layout/retained-geometry-translation.js';
import { resolveAnchorPlacement } from '../layout/anchor-frame.js';
import { endnoteIdsInRetainedSlice, footnoteIdsInRetainedSlice } from '../layout/note-reference-ownership.js';
import { imageResourceKey } from '../layout/source-key.js';
import { composeAffine } from '../layout/affine.js';
import { transformRect } from '../layout/coordinate-space.js';
import type { NativeReadingOwners } from './native-reading-owners.js';

/** Ordinary module graphs share these owners. The renderer worker passes this
 * same table across its sidecar boundary; the sidecar never imports defaults. */
export const readingDefaultOwners: NativeReadingOwners = {
  GeometryWorkBudgetError,
  drawingMLGeometryBounds,
  requireResolvedDrawingMLGeometry,
  imagePaintProjection,
  isDeepFrozenPlainDataRoot,
  snapshotPlainData,
  isLayoutSourceStore,
  planRetainedAnchorShape,
  retainedAnchorChildFrame,
  translateDrawing,
  translateParagraphLayout,
  resolveAnchorPlacement,
  endnoteIdsInRetainedSlice,
  footnoteIdsInRetainedSlice,
  imageResourceKey,
  composeAffine,
  transformRect,
};
