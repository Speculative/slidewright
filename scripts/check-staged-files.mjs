import { execFileSync } from 'node:child_process';

// Inspect staged blob sizes, not working files: partial staging and deletions
// must behave the same way as the commit Git is about to create.
const maxBytes = 1024 * 1024;
const records = execFileSync('git', [
  'diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z',
  '--diff-filter=ACMT',
], { encoding: 'utf8' }).split('\0');
const entries = [];
for (let i = 0; i < records.length - 1; i += 2) {
  const [, mode, , oid] = records[i].split(' ');
  if (mode !== '160000') entries.push({ oid, path: records[i + 1] });
}

if (entries.length) {
  const sizes = execFileSync('git', ['cat-file', '--batch-check=%(objectsize)'], {
    input: entries.map(({ oid }) => oid).join('\n') + '\n',
    encoding: 'utf8',
  }).trim().split('\n').map(Number);
  const oversized = entries.filter((_, i) => sizes[i] > maxBytes);
  if (oversized.length) {
    console.error('Commit blocked: staged files exceed the 1 MiB per-file limit:');
    for (const { path } of oversized) console.error(`  ${JSON.stringify(path)}`);
    console.error('Keep large assets outside Git and add an ignore rule for them.');
    process.exitCode = 1;
  }
}
