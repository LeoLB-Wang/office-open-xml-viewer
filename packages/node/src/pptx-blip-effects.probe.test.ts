import { describe, expect, it } from 'vitest';
import type { BlipEffect } from '@silurus/ooxml-core';
import type { Presentation, Slide } from '@silurus/ooxml-pptx';
import { renderSlideNode, type NodeCanvasFactory } from './render.js';
import { loadSkiaForTests } from './test-imports.js';

const skia = await loadSkiaForTests();
const factory: NodeCanvasFactory = {
  createCanvas: (w, h) => new skia!.Canvas(w, h) as unknown as ReturnType<NodeCanvasFactory['createCanvas']>,
  loadImage: (bytes) => skia!.loadImage(Buffer.from(bytes as Uint8Array)),
};

async function render(effects: BlipEffect[], site: 'picture' | 'background' | 'shape-fill') {
  const source = new skia!.Canvas(2, 2);
  const ctx = source.getContext('2d');
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 2, 2);
  const png = await source.toBuffer('png');
  const frame = { x: 0, y: 0, width: 32 * 9525, height: 32 * 9525,
    rotation: 0, flipH: false, flipV: false };
  const image = { imagePath: 'ppt/media/picture.png', mimeType: 'image/png', blipEffects: effects };
  const fill = { fillType: 'image' as const, ...image, stretch: true };
  const slide = { index: 0, slideNumber: 1,
    background: site === 'background' ? fill : null,
    elements: site === 'background' ? [] : site === 'shape-fill'
      ? [{ type: 'shape', ...frame, geometry: 'rect', fill, textBody: null }]
      : [{ type: 'picture', ...frame, ...image }],
  } as Slide;
  const presentation: Presentation = { slideWidth: frame.width, slideHeight: frame.height,
    slides: [slide], defaultTextColor: null, majorFont: null, minorFont: null };
  const canvas = new skia!.Canvas(32, 32);
  await renderSlideNode(canvas as unknown as Parameters<typeof renderSlideNode>[0], presentation, 0, {
    width: 32, dpr: 1, factory,
    fetchImage: async () => new Blob([new Uint8Array(png)]),
  });
  return [...canvas.getContext('2d').getImageData(16, 16, 1, 1).data];
}

describe.skipIf(!skia)('PPTX ordered blip paint', () => {
  it.each(['picture', 'background', 'shape-fill'] as const)('applies alpha-sensitive replacement exactly once on %s', async (site) => {
    expect(await render([
      { type: 'alphaModFix', amt: .5 },
      { type: 'colorChange', from: '000000', fromAlpha: 128 / 255,
        to: 'FF0000', toAlpha: 1, useAlpha: true },
    ], site)).toEqual([255, 0, 0, 255]);
  });
  it.each(['picture', 'background', 'shape-fill'] as const)('propagates unsupported effects on %s', async (site) => {
    await expect(render([
      { type: 'luminance', bright: .9, contrast: 0 },
      { type: 'unsupported', effect: 'blur' },
    ], site)).rejects.toMatchObject({ code: 'unsupported-image-effect' });
  });
});
