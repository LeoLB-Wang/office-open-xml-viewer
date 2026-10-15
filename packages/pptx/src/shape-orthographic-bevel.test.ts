import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from '@playwright/test';
import { build } from 'vite';
import { existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import type { PictureElement, ShapeElement } from './types.js';

function orthographicBeveledShape(): ShapeElement {
  return {
    type: 'shape',
    x: 914_400,
    y: 914_400,
    width: 914_400,
    height: 914_400,
    rotation: 0,
    flipH: false,
    flipV: false,
    geometry: 'roundRect',
    fill: { fillType: 'solid', color: '4472C4' },
    stroke: null,
    textBody: null,
    defaultTextColor: null,
    custGeom: null,
    adj: null,
    adj2: null,
    adj3: null,
    adj4: null,
    adj5: null,
    adj6: null,
    adj7: null,
    adj8: null,
    shadow: null,
    scene3d: {
      camera: { prst: 'orthographicFront' },
      lightRig: { rig: 'chilly', dir: 't' },
    },
    sp3d: {
      prstMaterial: 'translucentPowder',
      bevelT: { w: 127_000, h: 25_400, prst: 'softRound' },
    },
  };
}

function projectedBeveledShape(): ShapeElement {
  const shape = orthographicBeveledShape();
  return {
    ...shape,
    scene3d: {
      camera: { prst: 'isometricLeftUp' },
      lightRig: { rig: 'chilly', dir: 't' },
    },
  };
}


// Real browser pixels cover material ownership and camera routing; allocation
// counts cannot distinguish an extra warp buffer from a second material pass.
describe.skipIf(!existsSync(chromium.executablePath()))('shape bevel and camera pixels', () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    const result = await build({
      configFile: false, logLevel: 'error',
      define: { __OOXML_MODEL_SOURCES__: 'true' },
      // Preserve core module initialization in this isolated renderer bundle.
      build: { write: false, minify: false, rolldownOptions: { treeshake: false },
        lib: { entry: new URL('./renderer.ts', import.meta.url).pathname,
          formats: ['iife'], name: 'pptxRenderer' } },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const chunk = outputs.flatMap(output => 'output' in output ? output.output : [])
      .find(output => output.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Renderer bundle missing');
    browser = await chromium.launch({ channel: 'chromium' });
    page = await browser.newPage();
    await page.setContent('<!doctype html><canvas></canvas>');
    await page.addScriptTag({ content: chunk.code });
  }, 60_000);
  afterAll(async () => { await browser?.close(); });

  async function render(shape: ShapeElement | PictureElement, height = 400) {
    const png = await page.evaluate(async ({ shape, height }) => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      const renderer = (globalThis as unknown as { pptxRenderer: typeof import('./renderer') }).pptxRenderer;
      await renderer.renderSlide(canvas,
        { index: 0, slideNumber: 1, background: null, elements: [shape] },
        400 * 9525, height * 9525, { width: 400, dpr: 1, fetchImage: async () => {
          const source = document.createElement('canvas');
          source.width = source.height = 96;
          const ctx = source.getContext('2d') as CanvasRenderingContext2D;
          ctx.fillStyle = '#4472C4';
          ctx.fillRect(0, 0, 96, 96);
          return new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob as Blob)));
        } });
      return canvas.toDataURL('image/png').split(',')[1];
    }, { shape, height });
    return PNG.sync.read(Buffer.from(png, 'base64')).data;
  }
  const pixel = (data: Uint8Array, x: number, y: number) => [...data.subarray((y * 400 + x) * 4, (y * 400 + x) * 4 + 3)];

  for (const projected of [false, true]) {
    it(`applies translucent material once (${projected ? 'projected' : 'identity'} camera)`, async () => {
      const shape = projected ? projectedBeveledShape() : orthographicBeveledShape();
      shape.fill = { fillType: 'solid', color: '50648C' };
      shape.scene3d!.lightRig = { rig: 'contrasting', dir: 't' };
      const data = await render(shape);
      // Contrasting has ambient=1 and no diffuse. The flat material has alpha
      // .7, so (80,100,140) over white must be (133,147,175), within rounding.
      const center = pixel(data, 144, 144);
      for (const [i, expected] of [133, 147, 175].entries())
        expect(Math.abs(center[i] - expected)).toBeLessThanOrEqual(1);
    });
  }

  it('keeps projected text unshaded when an invisible shadow selects the effect path', async () => {
    const shape = projectedBeveledShape();
    shape.geometry = 'rect';
    shape.width *= 2;
    shape.textBody = {
      verticalAnchor: 'ctr', defaultFontSize: 32, defaultBold: false, defaultItalic: false,
      lIns: 0, rIns: 0, tIns: 0, bIns: 0, wrap: 'none', vert: 'horz', autoFit: 'none',
      paragraphs: [{ alignment: 'ctr', marL: 0, marR: 0, indent: 0,
        spaceBefore: null, spaceAfter: null, spaceLine: null, lvl: 0,
        bullet: { type: 'none' }, defFontSize: 32, defColor: 'FF0000',
        defBold: false, defItalic: false, defFontFamily: 'Arial', tabStops: [], eaLnBrk: true,
        runs: [{ type: 'text', text: 'MMMM', bold: false, italic: false, underline: false,
          strikethrough: false, fontSize: 32, color: 'FF0000', fontFamily: 'Arial' }] }],
    };
    const plain = await render(shape);
    const shadow = await render({ ...shape, shadow: { color: '000000', alpha: 0, blur: 0, dist: 0, dir: 0 } });
    const redPixels = (data: Uint8Array) => Array.from(data).reduce<number[]>((indices, r, i) => {
      if (i % 4 === 0 && r === 255 && data[i + 1] === 0 && data[i + 2] === 0) indices.push(i);
      return indices;
    }, []);
    expect(redPixels(plain).length).toBeGreaterThan(50);
    expect(redPixels(plain)).toEqual(redPixels(shadow));
  });

  it('projects a 100 by 1000 shape under a one-degree perspective tilt', async () => {
    const shape = orthographicBeveledShape();
    Object.assign(shape, { x: 50 * 9525, y: 80 * 9525, width: 100 * 9525,
      height: 1000 * 9525, geometry: 'rect', sp3d: undefined,
      scene3d: { camera: { prst: 'perspectiveFront', rot: { lat: 1, lon: 0, rev: 0 } } } });
    const data = await render(shape, 1200);
    // The tilted near edge extends above y=80 by roughly four pixels.
    expect(pixel(data, 100, 78)).toEqual([68, 114, 196]);
  });

  it('shows a back bevel only when the camera exposes the back face', async () => {
    const shape = orthographicBeveledShape();
    shape.sp3d = { prstMaterial: 'matte', bevelB: { w: 127000, h: 127000, prst: 'angle' } };
    const front = await render(shape);
    expect(pixel(front, 144, 144)).toEqual([68, 114, 196]);
    expect(pixel(front, 144, 105)).toEqual([68, 114, 196]);
    shape.scene3d!.camera = { prst: 'orthographicFront', rot: { lat: 0, lon: 180, rev: 0 } };
    const back = await render(shape);
    expect(pixel(back, 144, 144)).not.toEqual(pixel(await render({ ...shape, sp3d: undefined }), 144, 144));
    expect(pixel(back, 144, 105)).not.toEqual(pixel(back, 144, 144));
    shape.scene3d!.camera.rot!.lon = 150;
    shape.sp3d.extrusionH = 24 * 9525;
    const extruded = await render(shape);
    // The back plane moves 12 px right (24 * sin(150 degrees)). Its bevel
    // remains visible near x=190, with the wall extending toward the front.
    expect(pixel(extruded, 190, 144)).not.toEqual([255, 255, 255]);
    expect(pixel(extruded, 190, 144)).not.toEqual(pixel(extruded, 156, 144));
  });

  for (const adapter of ['shape', 'picture'] as const) {
    function element(shape: ShapeElement): ShapeElement | PictureElement {
      if (adapter === 'shape') return shape;
      return {
        type: 'picture', x: shape.x, y: shape.y, width: shape.width, height: shape.height,
        rotation: shape.rotation, flipH: shape.flipH, flipV: shape.flipV,
        imagePath: 'test/camera.png', mimeType: 'image/png', stroke: null,
        scene3d: shape.scene3d, sp3d: shape.sp3d, shadow: shape.shadow ?? undefined, softEdge: shape.softEdge,
      };
    }

    it(`keeps an extruded back face intact with an invisible shadow (${adapter})`, async () => {
      const shape = orthographicBeveledShape();
      shape.geometry = 'rect';
      shape.x = 180 * 9525;
      shape.scene3d!.camera = { prst: 'orthographicFront', rot: { lat: 0, lon: 110, rev: 0 } };
      shape.sp3d = { prstMaterial: 'matte', extrusionH: 24 * 9525,
        bevelB: { w: 127000, h: 127000, prst: 'angle' } };
      const plain = await render(element(shape));
      const shadow = await render(element({ ...shape,
        shadow: { color: '000000', alpha: 0, blur: 0, dist: 0, dir: 0 } }));
      expect(pixel(plain, 240, 144)).not.toEqual([255, 255, 255]);
      // An intermediate transparent cache can round premultiplied channels
      // by one; it must preserve the whole back face, not clip its far edge.
      const maxDifference = plain.reduce((max, value, i) => Math.max(max, Math.abs(value - shadow[i])), 0);
      expect(maxDifference).toBeLessThanOrEqual(1);
      if (adapter === 'picture') {
        const softened = await render(element({ ...shape, softEdge: { radius: 9525 } }));
        // This interior lies beyond the front-plane mask, but well inside the
        // back plane: a soft edge must not erase it using a stale front mask.
        expect(pixel(softened, 250, 144)).not.toEqual([255, 255, 255]);
      }
    });

    for (const wireframe of [false, true]) {
      it(`retains default oblique ${wireframe ? 'wireframe' : 'solid'} depth (${adapter})`, async () => {
        const shape = orthographicBeveledShape();
        shape.geometry = 'rect';
        shape.scene3d!.camera = { prst: 'obliqueTop' };
        shape.sp3d = { prstMaterial: wireframe ? 'legacyWireframe' : 'matte', extrusionH: 60 * 9525 };
        const deep = await render(element(shape));
        const flat = await render(element({ ...shape, sp3d: { ...shape.sp3d, extrusionH: 0 } }));
        // Default obliqueTop leaves the front unchanged and pushes the back
        // 18 px upward. Both its solid wall and wire rim extend above y=96.
        expect(pixel(deep, 144, 79)).not.toEqual([255, 255, 255]);
        expect(pixel(flat, 144, 79)).toEqual([255, 255, 255]);
      });
    }
  }

  it('renders wireframe rims with a transparent interior', async () => {
    const shape = projectedBeveledShape();
    shape.sp3d!.prstMaterial = 'legacyWireframe';
    const data = await render(shape);
    expect(pixel(data, 144, 144)).toEqual([255, 255, 255]);
    const ink = data.filter((v, i) => i % 4 === 0 && v < 250).length;
    expect(ink).toBeGreaterThan(100);
    expect(ink).toBeLessThan(3000);
  });
});
