#!/usr/bin/env node
// Generate packages/ooxml-common/src/spreadsheet_style_presets.generated.rs
// from ECMA-376 Part 1 Annex G presetTableStyles.xml: the built-in
// PivotTable styles (§18.8.40) as compact dictionary indices, decoded on lookup.
// Usage: node scripts/generate-spreadsheet-style-presets.mjs <presetTableStyles.xml>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = process.argv[2];
if (!source) throw new Error('usage: generate-spreadsheet-style-presets.mjs <presetTableStyles.xml>');
const xml = readFileSync(source, 'utf8');

const attr = (tag, name) => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? match[1] : null;
};
const color = (tag) => {
  if (!tag) return null;
  if (attr(tag, 'rgb') || attr(tag, 'indexed') || attr(tag, 'auto')) throw new Error(`unsupported color ${tag}`);
  const theme = attr(tag, 'theme');
  if (theme === null) throw new Error(`color without theme ${tag}`);
  const tint = attr(tag, 'tint');
  if (!Number.isInteger(Number(theme)) || Number(theme) < 0 || Number(theme) > 255) {
    throw new Error(`theme index exceeds u8: ${theme}`);
  }
  if (tint !== null && !Number.isFinite(Number(tint))) throw new Error(`invalid tint: ${tint}`);
  return [Number(theme), tint === null ? null : Number(tint)];
};
const known = /^(dxf|font|b|color|fill|patternFill|fgColor|bgColor|border|left|right|top|bottom|horizontal|vertical)$/;

/** One `<dxf>` as structured data, preserving absent versus present components. */
function dxfExpr(dxf) {
  for (const [, name] of dxf.matchAll(/<\/?(\w+)/g)) {
    if (!known.test(name)) throw new Error(`unsupported dxf element ${name} in ${dxf}`);
  }
  // PresetFont.bold means "<b/> present"; any other <b> form (val="0", ...)
  // would need the absent/explicit-off distinction the preset type lacks.
  if (/<b\s[^>]*>/.test(dxf)) throw new Error(`unsupported bold form in ${dxf}`);
  const font = /<font>([\s\S]*?)<\/font>/.exec(dxf);
  const fontExpr = font
    ? [/<b\/>/.test(font[1]), color(/<color [^>]*\/>/.exec(font[1])?.[0])]
    : null;
  const pattern = /<patternFill([^>]*)>([\s\S]*?)<\/patternFill>/.exec(dxf);
  const fillExpr = pattern
    ? [attr(pattern[1], 'patternType') ?? 'solid', color(/<fgColor [^>]*\/>/.exec(pattern[2])?.[0]), color(/<bgColor [^>]*\/>/.exec(pattern[2])?.[0])]
    : null;
  if (/<fill>/.test(dxf) && !pattern) throw new Error(`unsupported fill ${dxf}`);
  const border = /<border>([\s\S]*?)<\/border>/.exec(dxf);
  let borderExpr = null;
  if (border) {
    const edges = {};
    for (const [, name, attrs, body] of border[1].matchAll(/<(\w+)([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
      const style = attr(attrs, 'style');
      edges[name] = [style, color(body && /<color [^>]*\/>/.exec(body)?.[0])];
    }
    const edge = (name) => edges[name] ?? null;
    borderExpr = ['left', 'right', 'top', 'bottom', 'horizontal', 'vertical'].map(edge);
  }
  return [fontExpr, fillExpr, borderExpr];
}

const blocks = [...xml.matchAll(/<(PivotStyle(?:Light|Medium|Dark)\d+)>([\s\S]*?)<\/\1>/g)];
const dxfIds = new Map();
const styles = [];
for (const [, name, raw] of blocks) {
  const body = raw.trim().replace(/>\s+</g, '><');
  const local = [...body.matchAll(/<dxf>[\s\S]*?<\/dxf>/g)].map(([dxf]) => {
    const expr = JSON.stringify(dxfExpr(dxf));
    if (!dxfIds.has(expr)) dxfIds.set(expr, dxfIds.size);
    return dxfIds.get(expr);
  });
  const elements = [...body.matchAll(/<tableStyleElement type="(\w+)"(?: size="(\d+)")? dxfId="(\d+)"\/>/g)]
    .map(([, type, size, id]) => [type, Number(size ?? 1), local[Number(id)]]);
  if (elements.length === 0) throw new Error(`${name} has no elements`);
  styles.push([name, elements]);
}
// Index zero represents absence, never an explicitly present empty component.
// Bounds are checked here rather than truncating values into the emitted u8/u16.
function dictionary(maxIndex = 255) {
  const values = [];
  const ids = new Map();
  return {
    values,
    intern(value) {
      if (value === null) return 0;
      const key = JSON.stringify(value);
      if (!ids.has(key)) {
        if (values.length === maxIndex) throw new Error('component dictionary exceeds index width');
        values.push(value);
        ids.set(key, values.length);
      }
      return ids.get(key);
    },
  };
}
const tints = dictionary(), colors = dictionary(), fonts = dictionary();
const patterns = dictionary(), fills = dictionary(), edgeStyles = dictionary();
const edges = dictionary(), borders = dictionary(65535), kinds = dictionary(), sizes = dictionary();
const packColor = (c) => c === null ? 0 : colors.intern([c[0], tints.intern(c[1])]);
const packedDxfs = [...dxfIds.keys()].map((expr) => {
  const [font, fill, border] = JSON.parse(expr);
  const borderId = borders.intern(border === null ? null : border.map((edge) => edges.intern(
    edge === null ? null : [edgeStyles.intern(edge[0]), packColor(edge[1])],
  )));
  return [
    fonts.intern(font === null ? null : [Number(font[0]), packColor(font[1])]),
    fills.intern(fill === null ? null : [patterns.intern(fill[0]), packColor(fill[1]), packColor(fill[2])]),
    borderId & 255, borderId >>> 8,
  ];
});
const packedElements = [];
const packedStyles = styles.map(([name, elements]) => {
  const start = packedElements.length;
  for (const [kind, size, dxf] of elements) {
    if (!Number.isInteger(dxf) || dxf < 0 || dxf > 65535) throw new Error('invalid dxf index');
    if (!Number.isInteger(size) || size < 0 || size > 4294967295) throw new Error('invalid band size');
    packedElements.push([kinds.intern(kind), sizes.intern(size), dxf & 255, dxf >>> 8]);
  }
  if (packedElements.length > 65535) throw new Error('element offsets exceed u16');
  return [name, start, packedElements.length];
});
let out = `// Built-in PivotTable styles of ECMA-376 Part 1 Annex G
// (presetTableStyles.xml), packed without changing values or element order.
// Generated by scripts/generate-spreadsheet-style-presets.mjs; do not edit.

`;
function table(name, type, values, format = (v) => JSON.stringify(v)) {
  out += `static ${name}: [${type}; ${values.length}] = [\n`;
  for (const value of values) out += `    ${format(value)},\n`;
  out += '];\n\n';
}
table('PIVOT_TINTS', 'f64', tints.values, (v) => `${v}_f64`);
table('PIVOT_COLORS', '[u8; 2]', colors.values);
table('PIVOT_FONTS', '[u8; 2]', fonts.values);
table('PIVOT_PATTERNS', '&str', patterns.values);
table('PIVOT_FILLS', '[u8; 3]', fills.values);
table('PIVOT_EDGE_STYLES', '&str', edgeStyles.values);
table('PIVOT_EDGES', '[u8; 2]', edges.values);
table('PIVOT_BORDERS', '[u8; 6]', borders.values);
// A Dxf stores font/fill indices and a little-endian u16 border index; each
// component is decoded by the shared Rust resolver. Style element records
// similarly store kind/size indices followed by a little-endian u16 Dxf index.
table('PIVOT_DXFS', '[u8; 4]', packedDxfs);
table('PIVOT_KINDS', '&str', kinds.values);
table('PIVOT_SIZES', 'u32', sizes.values);
table('PIVOT_ELEMENTS', '[u8; 4]', packedElements);
table('PIVOT_STYLES', 'PresetStyleEntry', packedStyles,
  ([name, start, end]) => `(${JSON.stringify(name)}, ${start}, ${end})`);
const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(resolve(here, '../packages/ooxml-common/src/spreadsheet_style_presets.generated.rs'), out.trimEnd() + '\n');
console.log(`${styles.length} styles, ${dxfIds.size} dxfs, ${packedElements.length} elements`);
