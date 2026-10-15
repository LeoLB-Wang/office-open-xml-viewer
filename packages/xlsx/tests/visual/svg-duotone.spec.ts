import { test, expect } from '@playwright/test';

// Exercise the real Window SVG rasterizer: Chromium cannot reliably decode an
// SVG Blob with createImageBitmap, so a fake bitmap alone misses this failure.
test('SVG-only pictures retain duotone and alpha through browser rasterization', async ({ page }) => {
  await page.goto('/tests/visual/fixture.html?file=demo/sample-1.xlsx&sheet=0');
  const pixels = await page.evaluate(async () => {
    const modulePath = '/src/render-orchestrator.ts';
    const { decodeImageSource } = await import(/* @vite-ignore */ modulePath);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="1">'
      + '<path fill="black" d="M0 0h1v1H0z"/>'
      + '<path fill="white" d="M1 0h1v1H1z"/>'
      + '<path fill="white" fill-opacity="0.5" d="M2 0h1v1H2z"/></svg>';
    const fetchImage = async () => new Blob([svg], { type: 'image/svg+xml' });
    const source = await decodeImageSource(
      'xl/media/duotone.svg', 'image/svg+xml', undefined, fetchImage,
      3, 1, null, { clr1: '000000', clr2: 'FF0000' }, undefined, true,
    );
    if (!source) throw new Error('SVG duotone picture was omitted');
    const canvas = new OffscreenCanvas(3, 1);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Missing pixel readback context');
    context.drawImage(source, 0, 0);
    return Array.from(context.getImageData(0, 0, 3, 1).data);
  });
  expect(pixels).toEqual([0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 128]);
});
