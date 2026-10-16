// Production PPT -> native WASM -> companion -> Node error propagation.
import { expect, it } from 'vitest';
import { buildStoredZip } from '../zip-fixture.js';
import { anchor, buildPptFixture, concat, drawing, little16, little32, materialize, record, shapeAtom, slideAtom, spContainer } from './ppt-records.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const themeXml = `<a:theme xmlns:a="${A}"/>`;
const shapeXml = `<p:sp xmlns:p="${P}" xmlns:a="${A}"><p:nvSpPr><p:cNvPr id="1" name="Shape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1587500" cy="793750"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>`;
const relationships = (kind: string, target: string) => `<Relationships><Relationship Id="r1" Type="x/${kind}" Target="${target}"/></Relationships>`;
const theme = (xml = themeXml) => buildStoredZip({
  '_rels/.rels': relationships('officeDocument', 'manager.xml'),
  '_rels/manager.xml.rels': relationships('theme', 'theme.xml'), 'theme.xml': xml,
});
const blob = (xml = shapeXml) => buildStoredZip({ '_rels/.rels': relationships('shapeXml', 'shape.xml'), 'shape.xml': xml });
const input = (alternative: Uint8Array, masterTheme = theme()) => buildPptFixture(
  concat(slideAtom(100, 0), drawing(spContainer(shapeAtom(1, 1, 0x200), anchor(0, 0, 1000, 500),
    record(0x13, 0xf122, concat(little16(0x83a9), little32(alternative.length), alternative))))), undefined,
  concat(slideAtom(0, 0), record(0, 0x040e, masterTheme)),
);

// A ZIP encryption flag makes passwordless entry opening fail. Mark both
// headers so the reader must inspect metadata before trying to open content.
function encrypted(bytes: Uint8Array) {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  for (let i = 0; i < copy.length - 10; i++) {
    const signature = view.getUint32(i, true);
    if (signature === 0x04034b50) copy[i + 6] |= 1;
    if (signature === 0x02014b50) copy[i + 8] |= 1;
  }
  return copy;
}

it.each([
  { name: 'shape complexity', xml: shapeXml.replace('</p:sp>', `${'<x/>'.repeat(200_000)}</p:sp>`),
    resource: 'xml-dom', metric: 'complexity-units', limit: 200_000, observed: 200_001 },
  { name: 'shape depth', xml: '<x>'.repeat(257) + '</x>'.repeat(257),
    resource: 'xml-tree', metric: 'depth', limit: 256, observed: 257 },
])('preserves the measured $name envelope through Node', async ({ xml, resource, metric, limit, observed }) => {
  await expect(materialize(input(blob(xml)))).rejects.toMatchObject({
    code: 'ooxml-resource-limit', details: { stage: 'parsing', violation: { resource, metric, limit, observed } },
  });
});

it('keeps supplied theme complexity from degrading to a parser fallback', async () => {
  const xml = `<a:theme xmlns:a="${A}">${'<x/>'.repeat(200_000)}</a:theme>`;
  await expect(materialize(input(blob(), theme(xml)))).rejects.toMatchObject({
    code: 'ooxml-resource-limit', details: { stage: 'parsing', violation: {
      resource: 'xml-dom', metric: 'complexity-units', limit: 200_000, observed: 200_001,
    } },
  });
});

it.each(['alternative', 'theme'])('keeps embedded %s encryption typed through Node', async kind => {
  await expect(materialize(kind === 'alternative' ? input(encrypted(blob())) : input(blob(), encrypted(theme()))))
    .rejects.toMatchObject({ code: 'unsupported-encryption' });
});
