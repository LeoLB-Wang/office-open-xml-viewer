import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { rolldown } from 'rolldown';
import { checkDocxCompatibilityEvidence } from './check-docx-compatibility-evidence.mjs';
import {
  assertNoDocxCompatibilityDescriptions,
  docxCompatibilityMetadata,
  stripDocxCompatibilityMetadata,
} from './docx-compatibility-build.mjs';

const root = resolve(import.meta.dirname, '..');

test('bundles every source rule with the same frozen runtime ID and no metadata', async () => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'docx-compatibility-build-'));
  let bundle;
  try {
    const rules = checkDocxCompatibilityEvidence(root);
    const files = [...new Set(rules.map((rule) => rule.file))];
    const entry = resolve(fixture, 'entry.mjs');
    writeFileSync(entry, files.map((file, i) =>
      `import * as rules${i} from ${JSON.stringify(resolve(root, file))};`).join('\n')
      + `\nexport const rules = [${files.map((_, i) => `rules${i}`).join(',')}]
        .flatMap(module => Object.values(module)).filter(value => value && typeof value.id === 'string');`);
    bundle = await rolldown({ input: entry, plugins: [docxCompatibilityMetadata()],
      resolve: { extensionAlias: { '.js': ['.ts', '.js'] } } });
    const { output } = await bundle.generate({ format: 'es', minify: true });
    assert.equal(output.length, 1);
    const built = resolve(fixture, 'built.mjs');
    writeFileSync(built, output[0].code);
    const actual = (await import(pathToFileURL(built).href)).rules;
    assert.deepEqual(actual.map((rule) => rule.id).sort(), rules.map((rule) => rule.id).sort());
    for (const rule of actual) {
      assert.equal(Object.isFrozen(rule), true);
      assert.deepEqual(Object.keys(rule), ['id']);
    }
  } finally {
    await bundle?.close();
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('rejects shapes whose removal could hide effects or future runtime fields', () => {
  const rule = `defineCompatibilityRule({ id: 'word-test',
    evidence: { kind: 'regression-test', reference: 'path#test' }, description: 'evidence text' })`;
  for (const invalid of [
    rule.replace("description: 'evidence text'", 'description: loadDescription()'),
    rule.replace("reference: 'path#test'", 'reference: loadReference()'),
    rule.replace("id: 'word-test'", "...other, id: 'word-test'"),
    rule.replace("id: 'word-test'", "id: 'word-test', id: 'word-other'"),
    rule.replace("id: 'word-test'", "id: 'word-test', enabled: true"),
  ]) assert.throws(() => stripDocxCompatibilityMetadata(invalid, 'fixture.ts'));
});

test('bundle guard detects escaped descriptions and leaves unrelated strings alone', () => {
  const descriptions = new Set(['Evidence from Word']);
  assert.throws(() => assertNoDocxCompatibilityDescriptions(
    'export const leak = "Evidence from \\u0057ord";', descriptions, 'built.mjs'));
  assert.doesNotThrow(() => assertNoDocxCompatibilityDescriptions(
    'export const id = "word-test";', descriptions, 'built.mjs'));
});
