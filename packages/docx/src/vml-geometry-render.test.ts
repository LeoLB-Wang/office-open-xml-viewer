/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import { Canvas, loadImage } from 'skia-canvas';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import init, { DocxArchive } from './wasm/docx_parser.js';
import { storeZip } from './conformance/generate.js';
import { normalizeInternalDocumentModel } from './parser-model.js';
import { renderDocumentToCanvas } from './renderer.js';

const encode = (s: string) => new TextEncoder().encode(s);

beforeAll(async () => {
  await init({ module_or_path: await readFile(new URL('./wasm/docx_parser_bg.wasm', import.meta.url)) });
});
afterEach(() => vi.unstubAllGlobals());

async function renderVml(content: string, monochrome = false) {
  const source = new Canvas(20, 10);
  source.getContext('2d').fillStyle = monochrome ? '#000000' : '#ff0000';
  source.getContext('2d').fillRect(0, 0, 10, 10);
  source.getContext('2d').fillStyle = monochrome ? '#ffffff' : '#0000ff';
  source.getContext('2d').fillRect(10, 0, 10, 10);
  const png = new Uint8Array(source.toBufferSync('png'));
  vi.stubGlobal('OffscreenCanvas', Canvas);
  vi.stubGlobal('createImageBitmap', async (source: Blob | Canvas) => loadImage(source instanceof Blob
    ? Buffer.from(await source.arrayBuffer()) : source.toBufferSync('png')));
  const bytes = storeZip(new Map([
    ['[Content_Types].xml', encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')],
    ['_rels/.rels', encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')],
    ['word/_rels/document.xml.rels', encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="pic" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/two.png"/></Relationships>')],
    ['word/media/two.png', png],
    ['word/document.xml', encode(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:pict>
${content}</w:pict></w:r></w:p><w:sectPr><w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/></w:sectPr></w:body></w:document>`)],
  ]));
  const archive = new DocxArchive(bytes);
  let model;
  try { model = normalizeInternalDocumentModel(JSON.parse(new TextDecoder().decode(archive.parse()))).document; }
  finally { archive.free(); }
  const canvas = new Canvas(200, 200);
  const diagnostics: unknown[] = [];
  await renderDocumentToCanvas(model, canvas as unknown as HTMLCanvasElement, 0, {
    width: 200, dpr: 1, fetchImage: async () => new Blob([png], { type: 'image/png' }),
    onDiagnostic: d => diagnostics.push(d),
  });
  const pixels = canvas.getContext('2d').getImageData(0, 0, 200, 200).data;
  return { pixels, diagnostics, model };
}

function counter(pixels: Uint8ClampedArray) {
  const count = (r: number, g: number, b: number) => {
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === r && pixels[i + 1] === g && pixels[i + 2] === b && pixels[i + 3] === 255) n++;
    return n;
  };
  return count;
}

it('paints custom and inherited paths, primitives, cropped pixels and leaf shadows from a VML group', async () => {
  const { pixels, diagnostics } = await renderVml(`      <v:group style="width:140pt;height:120pt" coordsize="140,120">
        <v:shapetype id="triangle" coordsize="100,100" adj="100" path="m0,0l@0,0,0,100xe"><v:formulas><v:f eqn="val #0"/></v:formulas></v:shapetype>
        <v:shape type="#triangle" style="width:40;height:40" fillcolor="#ff00ff" stroked="f"/>
        <v:image src="media/two.png" style="left:50;width:40;height:40" cropleft="50%"/>
        <v:shape style="left:95;width:30;height:40" stroked="f"><v:imagedata r:id="pic" cropleft="32768f"/><v:shadow on="t" color="#ffa500" offset="4pt,4pt"/></v:shape>
        <v:rect style="top:50;width:20;height:20" fillcolor="yellow" stroked="f"><v:shadow on="t" color="lime" offset="10pt,10pt"/></v:rect>
        <v:polyline points="50,60 60,80 70,60" filled="f" strokecolor="#800080" strokeweight="3pt"/>
        <v:curve from="80,60" control1="80,80" control2="100,80" to="100,60" filled="f" strokecolor="#008080" strokeweight="3pt"/>
        <v:shape style="top:90;width:40;height:20" coordsize="100,100" path="m0,0l100,0,100,100,0,100xm25,25l75,25,75,75,25,75xe" fillcolor="#a52a2a" stroked="f"/>
        <v:arc style="left:110;top:60;width:20;height:20" filled="f" strokecolor="#808000" strokeweight="3pt"/>
      </v:group>`);
  const count = counter(pixels);
  expect(count(255, 0, 255)).toBeGreaterThan(500);
  expect(count(0, 0, 255)).toBeGreaterThan(2000);
  expect(count(255, 165, 0)).toBeGreaterThan(100);
  expect(count(255, 0, 0)).toBe(0); // The cropped-away left source half cannot leak.
  expect(count(0, 255, 0)).toBeGreaterThan(200); // Visible shadow outside the yellow rectangle.
  for (const color of [[128, 0, 128], [0, 128, 128], [128, 128, 0]]) {
    expect(count(color[0], color[1], color[2])).toBeGreaterThan(10);
  }
  expect(count(165, 42, 42)).toBeGreaterThan(400);
  expect(count(165, 42, 42)).toBeLessThan(700); // Same-winding inner contour is still a hole.
  expect(diagnostics).toEqual([]);
});

it('paints effective picture outlines and inherited opacity independently from the image', async () => {
  const { pixels, diagnostics } = await renderVml(`<v:group style="width:140pt;height:80pt" coordsize="140,80">
    <v:shapetype id="outlined"><v:stroke color="lime" weight="6pt"/></v:shapetype>
    <v:shape style="left:5;top:5;width:40;height:40" stroked="t" strokecolor="red" strokeweight="6pt"><v:imagedata r:id="pic" cropleft="50%"/></v:shape>
    <v:shape type="#outlined" style="left:60;top:5;width:40;height:40"><v:imagedata r:id="pic" cropleft="50%"/></v:shape>
  </v:group>`);
  const count = counter(pixels);
  expect(count(255, 0, 0)).toBeGreaterThan(200);
  expect(count(0, 255, 0)).toBeGreaterThan(200);
  expect(count(0, 0, 255)).toBeGreaterThan(1000);
  expect(diagnostics).toEqual([]);
});

it('paints zero and partial stroke alpha from direct and inherited stroke properties', async () => {
  const hidden = await renderVml(`<v:group style="width:80pt;height:80pt" coordsize="80,80"><v:rect style="left:10;top:10;width:40;height:40" filled="f"><v:stroke color="red" weight="6pt" opacity="0"/></v:rect></v:group>`);
  expect(counter(hidden.pixels)(255, 255, 255)).toBe(40000);
  const partial = await renderVml(`<v:group style="width:80pt;height:80pt" coordsize="80,80"><v:shapetype id="alpha"><v:stroke color="red" weight="6pt" opacity="32768f"/></v:shapetype><v:rect type="#alpha" style="left:10;top:10;width:40;height:40" filled="f"/></v:group>`);
  expect(counter(partial.pixels)(255, 127, 127)).toBeGreaterThan(300);
  expect(counter(partial.pixels)(255, 0, 0)).toBe(0);
  expect([...hidden.diagnostics, ...partial.diagnostics]).toEqual([]);
});

it('renders every non-solid VML fill through direct and inherited brushes', async () => {
  for (const fill of [
    '<v:fill type="gradient" color="red" color2="blue" angle="90" colors="50% lime"/>',
    '<v:fill type="gradientradial" color="red" color2="blue" focusposition="50%,50%" focussize="20%,20%"/>',
    '<v:fill type="tile" r:id="pic" size="20pt,20pt" origin="0,0"/>',
    '<v:fill type="pattern" r:id="pic" color="lime" color2="yellow" size="20pt,20pt" origin="0,0"/>',
    '<v:fill type="frame" r:id="pic"/>',
  ]) {
    const direct = await renderVml(`<v:rect style="width:80pt;height:80pt" stroked="f">${fill}</v:rect>`, true);
    const inherited = await renderVml(`<v:shapetype id="brush">${fill}</v:shapetype><v:rect type="#brush" style="width:80pt;height:80pt" stroked="f"/>`, true);
    const grouped = await renderVml(`<v:group style="width:80pt;height:80pt" coordsize="80,80"><v:shapetype id="brush">${fill}</v:shapetype><v:rect type="#brush" style="width:80;height:80" stroked="f"/></v:group>`, true);
    expect(counter(grouped.pixels)(255, 255, 255), fill).toBeLessThan(38000);
    expect(inherited.pixels, fill).toEqual(direct.pixels);
    const count = counter(direct.pixels);
    if (fill.includes('gradient')) {
      expect(count(255, 255, 255), fill).toBeLessThan(35000);
      // The gradient must contain mixed channels rather than a solid primary.
      let blended = 0;
      for (let i = 0; i < direct.pixels.length; i += 4) {
        const [r, g, b] = direct.pixels.slice(i, i + 3);
        if ([r, g, b].filter(channel => channel > 0 && channel < 255).length >= 2) blended++;
      }
      expect(blended, fill).toBeGreaterThan(100);
    } else if (fill.includes('pattern')) {
      expect(count(0, 255, 0), fill).toBeGreaterThan(1000);
      expect(count(255, 255, 0), fill).toBeGreaterThan(1000);
    } else {
      expect(count(0, 0, 0), fill).toBeGreaterThan(1000);
      expect(count(255, 255, 255), fill).toBeLessThan(38000);
    }
    if (!fill.includes('gradient')) {
      const target = fill.includes('pattern') ? [0, 255, 0] : [0, 0, 0];
      let maximumRuns = 0;
      for (let y = 0; y < 200; y++) {
        let runs = 0, inside = false;
        for (let x = 0; x < 200; x++) {
          const offset = (y * 200 + x) * 4;
          const matches = target.every((channel, i) => direct.pixels[offset + i] === channel);
          if (matches && !inside) runs++;
          inside = matches;
        }
        maximumRuns = Math.max(maximumRuns, runs);
      }
      if (fill.includes('frame')) expect(maximumRuns, fill).toBe(1);
      else expect(maximumRuns, fill).toBeGreaterThanOrEqual(3);
    }
    expect([...direct.diagnostics, ...inherited.diagnostics, ...grouped.diagnostics], fill).toEqual([]);
  }
});

it('paints arc, curve, polyline and image siblings beside a VML group', async () => {
  const { pixels, diagnostics } = await renderVml(`<v:group style="width:140pt;height:100pt"/>
    <v:arc style="left:10pt;top:10pt;width:20pt;height:20pt" filled="f" strokecolor="lime" strokeweight="4pt"/>
    <v:curve from="40,10" control1="40,30" control2="60,30" to="60,10" filled="f" strokecolor="yellow" strokeweight="4pt"/>
    <v:polyline points="70,10 80,30 90,10" filled="f" strokecolor="magenta" strokeweight="4pt"/>
    <v:image src="media/two.png" style="left:100pt;top:10pt;width:20pt;height:20pt" stroked="f"/>`);
  const count = counter(pixels);
  for (const color of [[0, 255, 0], [255, 255, 0], [255, 0, 255], [255, 0, 0], [0, 0, 255]]) {
    expect(count(...color as [number, number, number])).toBeGreaterThan(10);
  }
  expect(diagnostics).toEqual([]);
});

it('keeps a window-aligned frame brush upright through host rotation and reflection', async () => {
  const fill = '<v:fill type="frame" r:id="pic" alignshape="false"/>';
  const ordinary = await renderVml(`<v:rect style="width:80pt;height:80pt" stroked="f">${fill}</v:rect>`, true);
  const transformed = await renderVml(`<v:rect style="width:80pt;height:80pt;rotation:90;flip:x" stroked="f">${fill}</v:rect>`, true);
  expect(transformed.pixels).toEqual(ordinary.pixels);
  expect([...ordinary.diagnostics, ...transformed.diagnostics]).toEqual([]);
});
