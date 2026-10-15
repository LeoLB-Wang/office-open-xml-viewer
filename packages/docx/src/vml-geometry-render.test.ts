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

it('paints custom and inherited paths, primitives, cropped pixels and leaf shadows from a VML group', async () => {
  const source = new Canvas(2, 1);
  source.getContext('2d').fillStyle = '#ff0000';
  source.getContext('2d').fillRect(0, 0, 1, 1);
  source.getContext('2d').fillStyle = '#0000ff';
  source.getContext('2d').fillRect(1, 0, 1, 1);
  const png = new Uint8Array(source.toBufferSync('png'));
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => loadImage(Buffer.from(await blob.arrayBuffer())));
  const bytes = storeZip(new Map([
    ['[Content_Types].xml', encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')],
    ['_rels/.rels', encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')],
    ['word/_rels/document.xml.rels', encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="pic" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/two.png"/></Relationships>')],
    ['word/media/two.png', png],
    ['word/document.xml', encode(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:pict>
      <v:group style="width:140pt;height:120pt" coordsize="140,120">
        <v:shapetype id="triangle" coordsize="100,100" adj="100" path="m0,0l@0,0,0,100xe"><v:formulas><v:f eqn="val #0"/></v:formulas></v:shapetype>
        <v:shape type="#triangle" style="width:40;height:40" fillcolor="#ff00ff" stroked="f"/>
        <v:image src="media/two.png" style="left:50;width:40;height:40" cropleft="50%"/>
        <v:shape style="left:95;width:30;height:40" stroked="f"><v:imagedata r:id="pic" cropleft="32768f"/><v:shadow on="t" color="#ffa500" offset="4pt,4pt"/></v:shape>
        <v:rect style="top:50;width:20;height:20" fillcolor="yellow" stroked="f"><v:shadow on="t" color="lime" offset="10pt,10pt"/></v:rect>
        <v:polyline points="50,60 60,80 70,60" filled="f" strokecolor="#800080" strokeweight="3pt"/>
        <v:curve from="80,60" control1="80,80" control2="100,80" to="100,60" filled="f" strokecolor="#008080" strokeweight="3pt"/>
        <v:shape style="top:90;width:40;height:20" coordsize="100,100" path="m0,0l100,0,100,100,0,100xm25,25l75,25,75,75,25,75xe" fillcolor="#a52a2a" stroked="f"/>
        <v:arc style="left:110;top:60;width:20;height:20" filled="f" strokecolor="#808000" strokeweight="3pt"/>
      </v:group></w:pict></w:r></w:p><w:sectPr><w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0"/></w:sectPr></w:body></w:document>`)],
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
  const count = (r: number, g: number, b: number) => {
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === r && pixels[i + 1] === g && pixels[i + 2] === b && pixels[i + 3] === 255) n++;
    return n;
  };
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
