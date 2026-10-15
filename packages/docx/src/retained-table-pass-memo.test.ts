/// <reference types="node" />

import { readFile } from 'node:fs/promises';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import init, { DocxArchive } from './wasm/docx_parser.js';
import type { DocxDocumentModel } from './types.js';
import { normalizeInternalDocumentModel } from './parser-model.js';
import { createLayoutServices } from './layout-runtime.js';
import { layoutDocument } from './document-layout.js';
import { storeZip } from './conformance/generate.js';

// The memo is switched off per layout so each document is laid out both ways;
// hits count acquisitions served from another body pass.
const memo = vi.hoisted(() => ({ enabled: true, hits: 0, stores: 0 }));
vi.mock('./layout/retained-table-pass-cache.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./layout/retained-table-pass-cache.js')>();
  return {
    ...actual,
    retainedTableFromPassMemo: (...args: Parameters<typeof actual.retainedTableFromPassMemo>) => {
      if (!memo.enabled) return undefined;
      const retained = actual.retainedTableFromPassMemo(...args);
      if (retained) memo.hits += 1;
      return retained;
    },
    retainTableInPassMemo: (...args: Parameters<typeof actual.retainTableInPassMemo>) => {
      if (!memo.enabled) return;
      memo.stores += 1;
      actual.retainTableInPassMemo(...args);
    },
  };
});

const EMU = 12700;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
  0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const encoder = new TextEncoder();
const xml = (body: string) => encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`);

/** A paragraph-relative tight picture in P009 reaching 6 pt above its anchor
 * line: WORD_LATER_ANCHOR_EARLIER_LINE_WRAP carries it to its page and lays
 * the body out a second time (cross-paragraph-float-overlap.test.ts). */
function picture(): string {
  const w = 200 * EMU;
  const h = 96 * EMU;
  return '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" '
    + 'simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">'
    + '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH>'
    + `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${-6 * EMU}</wp:posOffset></wp:positionV>`
    + `<wp:extent cx="${w}" cy="${h}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`
    + '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/>'
    + '<wp:lineTo x="0" y="21600"/><wp:lineTo x="21600" y="21600"/><wp:lineTo x="21600" y="0"/>'
    + '<wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapTight><wp:docPr id="1" name="Picture 1"/>'
    + `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p.png"/>`
    + '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch>'
    + `</pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>'
    + '</wp:anchor></w:drawing></w:r>';
}

function table(label: string, autofit: boolean): string {
  const cell = (text: string) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>`
    + `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const rows = [0, 1, 2].map((row) => `<w:tr>${cell(`${label} r${row} first`)}${cell(`${label} r${row} second cell text`)}</w:tr>`);
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>`
    + `<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders>`
    + `<w:tblLayout w:type="${autofit ? 'autofit' : 'fixed'}"/></w:tblPr>`
    + '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="4000"/></w:tblGrid>'
    + `${rows.join('')}</w:tbl>`;
}

function docx(withPicture: boolean): Uint8Array {
  const body: string[] = [];
  for (let p = 0; p < 30; p += 1) {
    body.push('<w:p><w:pPr><w:widowControl w:val="0"/>'
      + '<w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="exact"/></w:pPr>'
      + `<w:r><w:t>P${String(p).padStart(3, '0')}</w:t></w:r>${withPicture && p === 9 ? picture() : ''}</w:p>`);
    // An ordinary table before the carried picture, an adjacent §17.4.37
    // pair after it and a table on the second page.
    if (p === 3) body.push(table('single', true));
    if (p === 12) body.push(table('first of pair', true), table('second of pair', false));
    if (p === 27) body.push(table('page two', true));
  }
  const document = `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}">`
    + `<w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>`
    + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
    + '</w:sectPr></w:body></w:document>';
  const styles = `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>`
    + '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
  const settings = `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" `
    + 'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return storeZip(new Map([
    ['[Content_Types].xml', xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
      + '</Types>')],
    ['_rels/.rels', xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`)],
    ['word/_rels/document.xml.rels', xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + `<Relationship Id="rIdStyles" Type="${rel}/styles" Target="styles.xml"/>`
      + `<Relationship Id="rIdSettings" Type="${rel}/settings" Target="settings.xml"/>`
      + `<Relationship Id="rIdImg" Type="${rel}/image" Target="media/p.png"/></Relationships>`)],
    ['word/document.xml', xml(document)],
    ['word/styles.xml', xml(styles)],
    ['word/settings.xml', xml(settings)],
    ['word/media/p.png', PNG],
  ]));
}

function measureContext(): CanvasRenderingContext2D {
  let font = '10px serif';
  return {
    get font() { return font; },
    set font(value: string) { font = value; },
    letterSpacing: '0px',
    fontKerning: 'normal',
    measureText: (text: string) => {
      const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '10');
      return {
        width: [...text].length * px * 0.5,
        fontBoundingBoxAscent: px * 0.8,
        fontBoundingBoxDescent: px * 0.2,
        actualBoundingBoxAscent: px * 0.8,
        actualBoundingBoxDescent: px * 0.2,
      } as TextMetrics;
    },
  } as unknown as CanvasRenderingContext2D;
}

function model(withPicture: boolean): DocxDocumentModel {
  const archive = new DocxArchive(docx(withPicture));
  try {
    return normalizeInternalDocumentModel(
      JSON.parse(new TextDecoder().decode(archive.parse())),
    ).document;
  } finally {
    archive.free();
  }
}

function layOut(document: DocxDocumentModel, enabled: boolean) {
  memo.enabled = enabled;
  const layout = layoutDocument(
    document,
    createLayoutServices(document, { measureContext: measureContext() }),
    { currentDateMs: 0 },
  );
  return JSON.stringify(layout.pages);
}

beforeAll(async () => {
  await init({ module_or_path: await readFile(new URL('./wasm/docx_parser_bg.wasm', import.meta.url)) });
});

beforeEach(() => {
  memo.enabled = true;
  memo.hits = 0;
  memo.stores = 0;
});

describe('cross-pass retained table memo', () => {
  it('serves the host-carry pass from the first pass without changing the layout', () => {
    const document = model(true);
    const memoized = layOut(document, true);
    // Single, two adjacent members and the page-two table: each acquired
    // once by the first pass and served again to the carried-anchor pass.
    expect(memo.stores).toBe(4);
    expect(memo.hits).toBe(4);
    expect(memoized.match(/"kind":"table"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(layOut(document, false) === memoized).toBe(true);
  });

  it('stays unused by a single-pass layout', () => {
    const document = model(false);
    const memoized = layOut(document, true);
    expect(memo.hits).toBe(0);
    expect(layOut(document, false) === memoized).toBe(true);
  });
});
