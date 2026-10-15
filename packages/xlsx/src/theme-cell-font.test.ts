import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderViewport } from './renderer.js';
import type { CellFont, Styles, Worksheet } from './types.js';

afterEach(() => vi.unstubAllGlobals());

function paintedFonts(platform: string): Map<string, string> {
  vi.stubGlobal('navigator', { platform, language: 'ja-JP', maxTouchPoints: 0 });
  const base: CellFont = { name: null, size: 11, bold: false, italic: false,
    underline: false, strike: false, color: null };
  const fonts: CellFont[] = [
    { ...base, name: 'Calibri', scheme: 'minor', bold: true, italic: false },
    { ...base, name: 'Arial', scheme: 'major', bold: false, italic: true },
    { ...base, name: '游ゴシック', bold: false, italic: false },
    { ...base, name: null, scheme: 'minor', bold: false, italic: false },
  ];
  const styles: Styles = {
    fonts, fills: [], borders: [], numFmts: [], dxfs: [],
    cellXfs: fonts.map((_, fontId) => ({ fontId, fillId: 0, borderId: 0, numFmtId: 0,
      alignH: null, alignV: null, wrapText: false })),
  };
  const ws = {
    name: 'Authored fonts', defaultColWidth: 20, defaultRowHeight: 15,
    colWidths: {}, rowHeights: {}, mergeCells: [], freezeRows: 0, freezeCols: 0,
    themeJapaneseMajorFont: '游ゴシック Light', themeJapaneseMinorFont: 'メイリオ',
    conditionalFormats: [], images: [], charts: [],
    rows: fonts.map((_, styleIndex) => ({ index: styleIndex + 1, height: null,
      cells: [{ row: styleIndex + 1, col: 1, styleIndex,
        value: { type: 'text', text: `cell${styleIndex}` } }] })),
  } as Worksheet;
  let font = '';
  const drawn = new Map<string, string>();
  const noop = () => {};
  const ctx = new Proxy({
    canvas: { width: 400, height: 200 },
    get font() { return font; },
    set font(value: string) { font = value; },
    measureText: () => ({ width: 35 }),
    fillText: (text: string) => drawn.set(text, font),
  } as Record<string, unknown>, {
    get: (target, key) => key in target ? target[key as string] : noop,
    set: (target, key, value) => { target[key as string] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  renderViewport(ctx, ws, styles, { row: 1, col: 1, rows: 4, cols: 1 });
  return drawn;
}

describe('authored cell fonts independent of viewer OS', () => {
  it('paints the same authored families and bold/italic styles on Japanese Mac and Windows', () => {
    const windows = paintedFonts('Win32');
    const mac = paintedFonts('MacIntel');
    expect(mac).toEqual(windows);
    expect(mac.get('cell0')).toMatch(/^700 15px "Calibri", /);
    expect(mac.get('cell1')).toMatch(/^italic 15px "Arial", /);
    expect(mac.get('cell2')).toMatch(/^15px "游ゴシック", /);
    expect(mac.get('cell3')).toMatch(/^15px "Calibri", /);
  });
});
