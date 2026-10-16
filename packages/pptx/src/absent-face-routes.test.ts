import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadOfficeFontFallbacks, unloadOfficeFontFallbacks } from '@silurus/ooxml-core';
import type { OfficeFontFallbackRequest } from '@silurus/ooxml-core';
import { PptxPresentation } from './presentation.js';
import { pptxSlideOfficeFontRequests } from './google-fonts.js';
import { officeFaceWeight } from './powerpoint-line-metrics.js';
import { buildFont, layoutParagraph } from './renderer.js';
import { acquireOfficeRoutes } from './office-route-acquisition.js';
import type { Paragraph, Slide } from './types.js';

// Line metrics admit a face's catalog geometry only when that face is present
// (its exact local() route was loaded). Acquisition must therefore probe every
// authored tuple, under the same weight the metric lookup uses.

function fakeHost() {
  const sources: string[] = [];
  class Face {
    status = 'unloaded';
    constructor(public family: string, public source: string, public descriptors: unknown) { sources.push(source); }
    async load() { this.status = 'loaded'; return this; }
  }
  vi.stubGlobal('FontFace', Face);
  const set = { add() {}, delete() { return true; }, *[Symbol.iterator]() {} } as unknown as FontFaceSet;
  return { sources, set };
}

function owner() {
  const value = Object.create(PptxPresentation.prototype) as {
    _destroyed: boolean; _embeddedFontTuples: Set<string>; _officeFontLoads: Map<unknown, unknown>;
    _officeRoutesForRequests(requests: OfficeFontFallbackRequest[], set: FontFaceSet): Promise<Record<string, unknown>>;
  };
  value._destroyed = false;
  value._embeddedFontTuples = new Set();
  value._officeFontLoads = new Map();
  return value;
}

function paragraph(): Paragraph {
  return {
    runs: [{ type: 'text', text: 'A', fontFamily: 'Arial', fontSize: 60, bold: false, italic: false },
      { type: 'break', fontFamily: 'Meiryo', fontSize: 16 }],
    endRunProperties: { fontFamily: 'Yu Gothic', fontSize: 16 },
    alignment: 'l', marL: 0, marR: 0, indent: 0, spaceBefore: null, spaceAfter: null, spaceLine: null,
    lvl: 0, bullet: { type: 'none' }, defFontSize: null, defColor: null, defBold: null, defItalic: null,
    defFontFamily: null, tabStops: [],
  } as unknown as Paragraph;
}

afterEach(() => vi.unstubAllGlobals());

describe('PPTX exact local() routes for absent-face line metrics', () => {
  it('acquires every authored family, not only one per weight/style slot', async () => {
    const { set } = fakeHost();
    const routes = await owner()._officeRoutesForRequests([
      { family: 'Arial', weight: 400, style: 'normal' },
      { family: 'Calibri', weight: 400, style: 'normal' }], set);
    expect(Object.keys(routes).sort()).toEqual(['arial', 'calibri']);
  });

  it('does not let an earlier failed tuple poison a later family', async () => {
    const { set } = fakeHost();
    const value = owner();
    // No catalog 400 profile exists for Calibri Light: no route, but no poisoning.
    await value._officeRoutesForRequests([{ family: 'Calibri Light', weight: 400, style: 'normal' }], set);
    const routes = await value._officeRoutesForRequests([{ family: 'Arial', weight: 400, style: 'normal' }], set);
    expect(routes.arial).toBeDefined();
  });

  it('loads each slide\'s new tuples in one bounded loader call', async () => {
    const calls: OfficeFontFallbackRequest[][] = [];
    const cache = new Map();
    const load = async (requests: OfficeFontFallbackRequest[]) => { calls.push(requests); return { faces: [], routes: {} }; };
    await acquireOfficeRoutes(cache, [{ family: 'Arial' }, { family: 'Calibri' }, { family: 'Arial' }], load);
    await acquireOfficeRoutes(cache, [{ family: 'Arial' }, { family: 'Georgia', weight: 700 }], load);
    expect(calls.map((batch) => batch.map((request) => request.family))).toEqual([['Arial', 'Calibri'], ['Georgia']]);
  });

  it('probes an installed named cut under its catalogued weight', async () => {
    expect(officeFaceWeight('Calibri Light', false, false)).toBe(300);
    // A bold run synthesizes bold on the Light face, which is still present.
    expect(officeFaceWeight('Calibri Light', true, false)).toBe(300);
    expect(officeFaceWeight('Arial', true, false)).toBe(700);
    const slide = { elements: [{ type: 'shape', textBody: { paragraphs: [{
      ...paragraph(), runs: [{ type: 'text', text: 'T', fontFamily: 'Calibri Light', fontSize: 40, bold: true, italic: false }],
      endRunProperties: undefined,
    }] } }] } as unknown as Slide;
    const requests = pptxSlideOfficeFontRequests(slide, null, null);
    expect(requests).toEqual([{ family: 'Calibri Light', weight: 300, style: 'normal' }]);
    const { set } = fakeHost();
    const loaded = await loadOfficeFontFallbacks(requests, set);
    try {
      expect(loaded.routes['calibri light:300:normal']).toBeDefined();
    } finally {
      unloadOfficeFontFallbacks(loaded.faces);
    }
  });

  it('requests the faces of line breaks and end marks, which contribute line metrics', () => {
    const requests = pptxSlideOfficeFontRequests(
      { elements: [{ type: 'shape', textBody: { paragraphs: [paragraph()] } }] } as unknown as Slide, null, null);
    expect(requests.map((request) => request.family)).toEqual(expect.arrayContaining(['Arial', 'Meiryo', 'Yu Gothic']));
  });

  it('uses a non-Calibri exact private alias in both layout measurement and retained paint style', () => {
    const fonts: string[] = [];
    const ctx = { font: '', measureText: () => { fonts.push(ctx.font); return { width: 10 }; } } as unknown as CanvasRenderingContext2D;
    const alias = '__exact_arial';
    const rc = { themeMajorFont: null, themeMinorFont: null, dpr: 1,
      officeFontRoutes: { arial: { family: alias } } } as unknown as Parameters<typeof buildFont>[4];
    const p = paragraph();
    p.runs = p.runs.slice(0, 1);
    (p as { endRunProperties?: unknown }).endRunProperties = undefined;
    const lines = layoutParagraph(ctx, p, 1000, 60, '000000', 1 / 12700, 0, false, false, 1, 1, rc);
    expect(buildFont(false, false, 60, 'Arial', rc)).toContain(alias);
    expect(fonts.every((font) => font.includes(alias))).toBe(true);
    expect(lines[0]!.segments[0]!.font).toContain(alias);
  });
});
