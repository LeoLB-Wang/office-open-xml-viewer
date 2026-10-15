/** Decoded-image admission only. Layout and source acquisition stay outside
 * the paint graph; the selected-source runtime installs these guards before
 * it can retain or paint a reading page. */
interface ReadingPaintHooks {
  assertNativeReadingImageAvailable: typeof import('./native-reading-image-availability.js').assertNativeReadingImageAvailable;
  assertNativeReadingImageBinding: typeof import('./native-reading-image-availability.js').assertNativeReadingImageBinding;
}
function unavailable(): never { throw new Error('Reading source runtime is not initialized'); }
export const readingPaintHooks: ReadingPaintHooks = {
  assertNativeReadingImageAvailable: unavailable,
  assertNativeReadingImageBinding: unavailable,
};
export function installReadingPaintHooks(hooks: ReadingPaintHooks): void { Object.assign(readingPaintHooks, hooks); }
