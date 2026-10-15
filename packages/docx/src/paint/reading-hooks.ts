/** Decoded-image admission only. Layout and source acquisition stay outside
 * the paint graph; the selected-source runtime installs these guards before
 * it can retain or paint a reading page. */
interface ReadingPaintHooks {
  pageAdmission: typeof import('./native-reading-page-admission.js').readingPageAdmission;
  assertPageImages: typeof import('./native-reading-page-admission.js').assertReadingPageImages;
  assertNativeReadingImageBinding: typeof import('./native-reading-image-availability.js').assertNativeReadingImageBinding;
}
function unavailable(): never { throw new Error('Reading source runtime is not initialized'); }
export const readingPaintHooks: ReadingPaintHooks = {
  pageAdmission: () => undefined,
  assertPageImages: unavailable,
  assertNativeReadingImageBinding: unavailable,
};
export function installReadingPaintHooks(hooks: ReadingPaintHooks): void { Object.assign(readingPaintHooks, hooks); }
