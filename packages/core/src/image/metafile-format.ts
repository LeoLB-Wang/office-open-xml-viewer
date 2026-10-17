// WMF/EMF format detection and raster sizing, shared by the decode boundary
// and the metafile players. Kept apart from the players (wmf.ts, emf.ts,
// emf-plus.ts) so recognizing a metafile does not load them: the decode
// boundary imports the players only when it actually rasterizes one.

export const PLACEABLE_MAGIC = 0x9ac6cdd7; // little-endian bytes D7 CD C6 9A
export const PLACEABLE_HEADER_BYTES = 22;
export const WMF_HEADER_BYTES = 18;
const EMF_SIGNATURE = 0x464d4520; // " EMF" (bytes 20 45 4D 46)

// ── detection ───────────────────────────────────────────────────────────────

/** Reads the standard 18-byte WMF header at `off` and validates type∈{1,2} and
 *  headerSize==9 words. */
function looksLikeStandardHeader(b: Uint8Array, off: number): boolean {
  if (b.length < off + WMF_HEADER_BYTES) return false;
  const type = b[off] | (b[off + 1] << 8);
  const headerSize = b[off + 2] | (b[off + 3] << 8);
  return (type === 1 || type === 2) && headerSize === 9;
}

/** True for a placeable (`D7 CD C6 9A`) or standard (type∈{1,2}, headerSize==9)
 *  WMF. A placeable file prepends a 22-byte header before the standard one. */
export function isWmf(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const magic =
    bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  if ((magic >>> 0) === PLACEABLE_MAGIC) {
    // Be lenient: a placeable file is a WMF even if we can't re-validate the
    // inner header (some toolchains emit slightly off inner fields).
    return true;
  }
  return looksLikeStandardHeader(bytes, 0);
}

/** True for a true EMF (ENHMETAHEADER): u32@0 == 1 (EMR_HEADER) AND u32@40 ==
 *  0x464D4520 (" EMF"). True EMF is a different, larger 32-bit format than WMF;
 *  it is rasterized by the sibling player {@link ./emf.ts}#renderEmfToBitmap. */
export function isEmf(bytes: Uint8Array): boolean {
  if (bytes.length < 44) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return dv.getUint32(0, true) === 1 && dv.getUint32(40, true) === EMF_SIGNATURE;
}

/** True for the WMF/EMF metafile MIME types (`image/wmf`, `image/emf`). Used by
 *  the shared `<a:srcRect>` crop (ECMA-376 §20.1.8.55): a metafile carries no
 *  native pixel grid, so a cropped one must be rasterized at its FULL picture
 *  frame before the fractional crop applies (see {@link ./crop.ts}'s
 *  `metafileRasterSize`); raster blips skip that scale-up. The MIME is
 *  extension-derived by the parsers (`mime_from_ext`), so a metafile mislabeled
 *  with a raster extension would be treated as a raster — acceptable because
 *  authored crops on metafiles are rare. */
export function isMetafileMime(mime: string | undefined): boolean {
  return mime === 'image/wmf' || mime === 'image/emf';
}

// ── raster sizing ───────────────────────────────────────────────────────────

/** Upper bound for a metafile raster dimension (px). Keeps memory bounded for
 *  large intended draw sizes while staying sharp at typical chart sizes. */
const WMF_RASTER_MAX_PX = 2000;
/** Supersampling factor for metafile rasterization (≈retina). The draw site
 *  scales the bitmap to the resolved box via `drawImage`, so a higher intrinsic
 *  resolution just buys sharper vector edges. */
const WMF_RASTER_SCALE = 2;

/** Pick a raster target size (px) for a vector metafile from its intended draw
 *  size (pt), supersampled and capped. Falls back to a sane square when the
 *  intended size is unknown (0). */
export function wmfRasterTarget(widthPt: number, heightPt: number): { w: number; h: number } {
  const fallbackPt = 300; // ~4 inch — only used when no size is surfaced
  const wPt = widthPt > 0 ? widthPt : fallbackPt;
  const hPt = heightPt > 0 ? heightPt : fallbackPt;
  const clamp = (n: number) => Math.max(1, Math.min(WMF_RASTER_MAX_PX, Math.round(n)));
  return { w: clamp(wPt * WMF_RASTER_SCALE), h: clamp(hPt * WMF_RASTER_SCALE) };
}
