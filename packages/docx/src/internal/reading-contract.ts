/** Public disclosure of changed reading layout, never an Office layout claim. */
export interface DocxReadingNotice {
  readonly code: 'DRAWINGS_RELOCATED_FOR_READING' | 'INACTIVE_PICTURE_DATA_RETAINED'
    | 'WORD_BREAKING_SIMPLIFIED_FOR_READING' | 'PICTURE_BULLETS_SIZED_FOR_READING';
  readonly message: string;
}
/** Acquired source facts stay distinct. Their union owns atomic publication,
 * while disclosures still require the corresponding owner and visible layout.
 * In particular, a hidden picture marker cannot imply word-breaking reading. */
export interface NativeReadingRequests {
  readonly contour: boolean;
  readonly wordBreaking: boolean;
  readonly pictureBullets: boolean;
}
export const noNativeReadingRequests: NativeReadingRequests = Object.freeze({
  contour: false, wordBreaking: false, pictureBullets: false,
});
export const noReadingNotices: readonly DocxReadingNotice[] = Object.freeze([]);
