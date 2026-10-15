import { TiffDecodeError } from './tiff-contract.js';

/**
 * TIFF 6.0 §13 LZW and §11/CCITT T.6 (FillOrder 1) use MSB-first packed codes.
 * The caller validates the strip byte range. Keep byte positions as arithmetic
 * numbers: even a valid strip can exceed 2^31 bits, where bitwise indexing
 * wraps. Only the 0..7 bit position and at most 12-bit code values are shifted.
 */
export class TiffBitReader {
  private byteCursor = 0;
  private byteEnd = 0;
  private bitInByte = 0;

  constructor(
    private readonly bytes: ArrayLike<number>,
    byteOffset: number,
    byteLength: number,
    private readonly truncatedMessage: string,
  ) {
    this.beginStrip(byteOffset, byteLength);
  }

  beginStrip(byteOffset: number, byteLength: number): void {
    this.byteCursor = byteOffset;
    this.byteEnd = byteOffset + byteLength;
    this.bitInByte = 0;
  }

  /** Read one LZW code (9..12 bits), or fewer bits for another packed code. */
  readBits(count: number): number {
    if (count > (this.byteEnd - this.byteCursor) * 8 - this.bitInByte) {
      throw new TiffDecodeError(this.truncatedMessage);
    }
    let value = 0;
    // Consume up to a byte per iteration, with no per-bit division or lookup.
    while (count > 0) {
      const available = 8 - this.bitInByte;
      const take = Math.min(count, available);
      value = (value << take)
        | ((this.bytes[this.byteCursor] >> (available - take)) & ((1 << take) - 1));
      this.bitInByte += take;
      if (this.bitInByte === 8) {
        this.byteCursor++;
        this.bitInByte = 0;
      }
      count -= take;
    }
    return value;
  }

  readBit(): number {
    if (this.byteCursor >= this.byteEnd) throw new TiffDecodeError(this.truncatedMessage);
    const bit = (this.bytes[this.byteCursor] >> (7 - this.bitInByte)) & 1;
    this.bitInByte++;
    if (this.bitInByte === 8) {
      this.byteCursor++;
      this.bitInByte = 0;
    }
    return bit;
  }
}
