// Minimal node20 GitHub Action entrypoint. Reads the `files` input (a glob),
// converts each matching .pptx / .docx / .xlsx to markdown via the workspace
// CLI, and optionally commits the result.
//
// This file is intentionally dependency-free so it can run from a built
// artifact without `npm install` in the runner.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, join, extname, dirname, basename } from 'node:path';

const INPUT_FILES = process.env.INPUT_FILES ?? '';
const INPUT_OUT_DIR = process.env['INPUT_OUT-DIR'] ?? '';
const INPUT_COMMIT = (process.env.INPUT_COMMIT ?? 'false').toLowerCase() === 'true';

if (!INPUT_FILES) {
  console.error('::error::No files input provided');
  process.exit(1);
}

// Tiny glob: supports `**/*.ext` and direct paths. For anything fancier,
// users can run multiple invocations.
function walk(root, predicate, out = []) {
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    // lstat: symlinks (to directories or files) are never followed, so a link
    // cycle cannot recurse forever and a link cannot pull a file from outside
    // the walked tree into the conversion.
    const st = lstatSync(full);
    if (st.isDirectory()) walk(full, predicate, out);
    else if (st.isFile() && predicate(full)) out.push(full);
  }
  return out;
}

function match(filesGlob) {
  // Special-case the common patterns.
  if (filesGlob.includes('**')) {
    const [base, rest] = filesGlob.split('**');
    const ext = rest.split('.').pop();
    return walk(resolve(base || '.'), (f) => f.toLowerCase().endsWith('.' + ext.toLowerCase()));
  }
  if (existsSync(filesGlob) && lstatSync(filesGlob).isFile()) return [resolve(filesGlob)];
  console.error(`::warning::Pattern "${filesGlob}" matched no files`);
  return [];
}

const matched = match(INPUT_FILES);
console.log(`Matched ${matched.length} files for conversion.`);

const here = dirname(new URL(import.meta.url).pathname);
const cliBin = resolve(here, '../bin/ooxml-md.mjs');

const written = [];
for (const src of matched) {
  const ext = extname(src).toLowerCase();
  if (!['.pptx', '.docx', '.xlsx'].includes(ext)) continue;
  const targetDir = INPUT_OUT_DIR ? resolve(INPUT_OUT_DIR) : dirname(src);
  mkdirSync(targetDir, { recursive: true });
  const out = join(targetDir, basename(src, ext) + '.md');
  try {
    // Repository file names are untrusted: pass them as argv entries, never
    // through a shell command line where `$(...)`, backticks or quotes in a
    // name would execute on the runner.
    execFileSync(process.execPath, [cliBin, src, '-o', out], { stdio: 'inherit' });
    written.push(out);
  } catch (err) {
    console.error(`::error::Conversion failed for ${src}: ${err.message}`);
  }
}

if (INPUT_COMMIT && written.length > 0) {
  // --literal-pathspecs: an output name such as `report*.md` must stage only
  // that file, not every path the glob would match.
  execFileSync('git', ['--literal-pathspecs', 'add', '--', ...written]);
  execFileSync('git', [
    '-c', 'user.email=action@github.com',
    '-c', 'user.name=ooxml-to-markdown action',
    'commit', '-m', `chore: regenerate OOXML markdown (${written.length} files)`,
  ]);
}

console.log(`Wrote ${written.length} markdown files.`);
