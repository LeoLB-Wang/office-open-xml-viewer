import { afterEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({
  loadOfficeFontFallbacks: vi.fn(),
  officeFontRequestDeclared: vi.fn(() => false),
  unloadOfficeFontFallbacks: vi.fn(),
}));
vi.mock('@silurus/ooxml-core', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  ...core,
}));

import { PptxPresentation } from './presentation.js';

const REGULAR = { family: 'Calibri', weight: 400, style: 'normal' } as const;
const route = (tag: string) => ({ faces: [{ tag }], routes: { calibri: { tag } }, checked: ['calibri'] });

function presentation(fonts: FontFaceSet) {
  vi.stubGlobal('document', { fonts });
  const instance = Object.create(PptxPresentation.prototype) as Record<string, unknown>;
  instance._destroyed = false;
  instance._embeddedFontTuples = new Set<string>();
  instance._officeFontLoads = new Map();
  instance._themeRoutePrefetch = null;
  return instance as unknown as {
    _prefetchThemeOfficeRoute(bootstrap: object): void;
    _officeRoutesForRequests(requests: object[], set: FontFaceSet): Promise<Record<string, unknown>>;
  };
}

const bootstrap = (embeddedFonts: object[] = []) => ({ majorFont: 'Calibri Light', minorFont: 'Calibri', embeddedFonts });

afterEach(() => {
  vi.unstubAllGlobals();
  for (const mock of Object.values(core)) mock.mockReset();
  core.officeFontRequestDeclared.mockReturnValue(false);
});

describe('PptxPresentation theme Calibri route prefetch', () => {
  it('lets the first render reuse the load started at bootstrap', async () => {
    const fonts = {} as FontFaceSet;
    core.loadOfficeFontFallbacks.mockResolvedValue(route('prefetch'));
    const p = presentation(fonts);
    p._prefetchThemeOfficeRoute(bootstrap());
    expect(core.loadOfficeFontFallbacks).toHaveBeenCalledTimes(1);
    await expect(p._officeRoutesForRequests([REGULAR], fonts)).resolves.toEqual({ calibri: { tag: 'prefetch' } });
    expect(core.loadOfficeFontFallbacks).toHaveBeenCalledTimes(1);
  });

  it('discards the speculative route when the application declared the face before render', async () => {
    const fonts = {} as FontFaceSet;
    core.loadOfficeFontFallbacks.mockResolvedValueOnce(route('prefetch'))
      .mockResolvedValueOnce({ faces: [], routes: {}, checked: [] });
    const p = presentation(fonts);
    p._prefetchThemeOfficeRoute(bootstrap());
    core.officeFontRequestDeclared.mockReturnValue(true);
    await expect(p._officeRoutesForRequests([REGULAR], fonts)).resolves.toEqual({});
    expect(core.loadOfficeFontFallbacks).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(core.unloadOfficeFontFallbacks).toHaveBeenCalledWith([{ tag: 'prefetch' }]));
  });

  it('retries on first use when the speculative load timed out or failed', async () => {
    for (const first of [
      () => Promise.resolve({ faces: [{ tag: 'timeout' }], routes: {}, checked: [] }),
      () => Promise.reject(new Error('local() failed')),
    ]) {
      const fonts = {} as FontFaceSet;
      core.loadOfficeFontFallbacks.mockReset();
      core.loadOfficeFontFallbacks.mockImplementationOnce(first).mockResolvedValueOnce(route('retry'));
      const p = presentation(fonts);
      p._prefetchThemeOfficeRoute(bootstrap());
      await expect(p._officeRoutesForRequests([REGULAR], fonts)).resolves.toEqual({ calibri: { tag: 'retry' } });
      expect(core.loadOfficeFontFallbacks).toHaveBeenCalledTimes(2);
      // A later render reuses the retried load.
      await expect(p._officeRoutesForRequests([REGULAR], fonts)).resolves.toEqual({ calibri: { tag: 'retry' } });
      expect(core.loadOfficeFontFallbacks).toHaveBeenCalledTimes(2);
    }
    expect(core.unloadOfficeFontFallbacks).toHaveBeenCalledWith([{ tag: 'timeout' }]);
  });

  it('starts nothing while an application face covers the tuple, so a later uncovered render loads fresh', async () => {
    const fonts = {} as FontFaceSet;
    core.loadOfficeFontFallbacks.mockResolvedValue(route('fresh'));
    const p = presentation(fonts);
    core.officeFontRequestDeclared.mockReturnValue(true);
    p._prefetchThemeOfficeRoute(bootstrap());
    expect(core.loadOfficeFontFallbacks).not.toHaveBeenCalled();
    core.officeFontRequestDeclared.mockReturnValue(false);
    await expect(p._officeRoutesForRequests([REGULAR], fonts)).resolves.toEqual({ calibri: { tag: 'fresh' } });
    expect(core.loadOfficeFontFallbacks).toHaveBeenCalledTimes(1);
  });

  it('starts nothing for an embedded regular Calibri but still for an embedded bold-only one', () => {
    const fonts = {} as FontFaceSet;
    core.loadOfficeFontFallbacks.mockResolvedValue(route('prefetch'));
    presentation(fonts)._prefetchThemeOfficeRoute(bootstrap([{ fontName: 'Calibri', style: 'regular' }]));
    expect(core.loadOfficeFontFallbacks).not.toHaveBeenCalled();
    presentation(fonts)._prefetchThemeOfficeRoute(bootstrap([{ fontName: 'Calibri', style: 'bold' }]));
    expect(core.loadOfficeFontFallbacks).toHaveBeenCalledTimes(1);
  });
});
