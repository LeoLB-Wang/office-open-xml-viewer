import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The GitHub Action converts files found by walking the repository. Their
// names are attacker-controlled (any contributor can commit a file), so a
// name must never reach a shell command line.
const ACTION = resolve(import.meta.dirname, '../action/index.js');

describe('ooxml-to-markdown GitHub Action', () => {
  it('passes repository file names to child processes without a shell', () => {
    const root = mkdtempSync(join(tmpdir(), 'ooxml-md-action-'));
    try {
      const marker = join(root, 'PWNED');
      for (const name of ['a$(touch PWNED).docx', 'b`touch PWNED`.docx', 'c";touch PWNED;".docx']) {
        writeFileSync(join(root, name), 'not a package');
      }
      // A symlink (here to a file outside the walked tree) is never followed.
      const outside = mkdtempSync(join(tmpdir(), 'ooxml-md-outside-'));
      writeFileSync(join(outside, 'secret.docx'), 'not a package');
      symlinkSync(join(outside, 'secret.docx'), join(root, 'link.docx'));
      const run = spawnSync(process.execPath, [ACTION], {
        cwd: root,
        env: { ...process.env, INPUT_FILES: `${root}/**/*.docx`, INPUT_COMMIT: 'false' },
        encoding: 'utf8',
      });
      expect(run.stdout).toContain('Matched 3 files');
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
