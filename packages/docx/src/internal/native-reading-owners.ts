/** Stateless layout owners are injected before acquisition. The URL-loaded
 * worker sidecar must use the renderer's seals and shared geometry/layout
 * implementations, without bundling fallback copies. Browser/Node defaults
 * are initialized separately by native-reading-runtime.ts. No document lives
 * in this binding. */
export interface NativeReadingOwners {
  readonly GeometryWorkBudgetError: typeof import('@silurus/ooxml-core').GeometryWorkBudgetError;
  readonly drawingMLGeometryBounds: typeof import('@silurus/ooxml-core').drawingMLGeometryBounds;
  readonly requireResolvedDrawingMLGeometry: typeof import('@silurus/ooxml-core').requireResolvedDrawingMLGeometry;
  readonly imagePaintProjection: typeof import('@silurus/ooxml-core').imagePaintProjection;
  readonly isDeepFrozenPlainDataRoot: typeof import('../layout/plain-data.js').isDeepFrozenPlainDataRoot;
  readonly snapshotPlainData: typeof import('../layout/plain-data.js').snapshotPlainData;
  readonly isLayoutSourceStore: typeof import('../layout/layout-source-store.js').isLayoutSourceStore;
  readonly planRetainedAnchorShape: typeof import('../layout/retained-anchor-shape.js').planRetainedAnchorShape;
  readonly retainedAnchorChildFrame: typeof import('../layout/retained-anchor-child-frame.js').retainedAnchorChildFrame;
  readonly translateDrawing: typeof import('../layout/retained-geometry-translation.js').translateDrawing;
  readonly translateParagraphLayout: typeof import('../layout/retained-geometry-translation.js').translateParagraphLayout;
  readonly resolveAnchorPlacement: typeof import('../layout/anchor-frame.js').resolveAnchorPlacement;
  readonly endnoteIdsInRetainedSlice: typeof import('../layout/note-reference-ownership.js').endnoteIdsInRetainedSlice;
  readonly footnoteIdsInRetainedSlice: typeof import('../layout/note-reference-ownership.js').footnoteIdsInRetainedSlice;
  readonly imageResourceKey: typeof import('../layout/source-key.js').imageResourceKey;
  readonly composeAffine: typeof import('../layout/affine.js').composeAffine;
  readonly transformRect: typeof import('../layout/coordinate-space.js').transformRect;
}
export let nativeReadingOwners: NativeReadingOwners;
export function bindNativeReadingOwners(owners: NativeReadingOwners): void {
  nativeReadingOwners = owners;
}
