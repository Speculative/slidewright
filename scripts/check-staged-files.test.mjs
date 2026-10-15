import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'slidewright-hook-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  // A caller may itself be a Git hook; fixture operations need their own index.
  for (const name of ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) delete env[name];
  const git = (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '-q');
  git('config', 'user.name', 'Hook Test');
  git('config', 'user.email', 'hook@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  mkdirSync(join(cwd, 'scripts'));
  mkdirSync(join(cwd, '.githooks'));
  for (const file of ['scripts/check-staged-files.mjs', '.githooks/pre-commit']) {
    copyFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(cwd, file));
  }
  git('config', 'core.hooksPath', '.githooks');
  const check = () => spawnSync(process.execPath, ['scripts/check-staged-files.mjs'], { cwd, env, encoding: 'utf8' });
  const write = (name, contents) => writeFileSync(join(cwd, name), contents);
  return { cwd, git, check, write };
}

test('checks staged sizes, including binary data, unusual paths, and force-adds', t => {
  const { git, check, write } = repository(t);
  write('.gitignore', '*.mp4\n');
  write('small.txt', 'small');
  git('add', '.gitignore', 'small.txt');
  assert.equal(check().status, 0);
  // A real commit invokes the installed executable hook.
  git('commit', '-qm', 'small files pass');
  const name = 'large video\nwith spaces.mp4';
  write(name, Buffer.alloc(1024 * 1024 + 1));
  git('add', '-f', '--', name);
  write(name, 'small working copy must not hide large staged blob');
  const result = check();
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(JSON.stringify(name)));
  assert.throws(() => git('commit', '-qm', 'must be blocked'), /Commit blocked/);
  // Restaging the small version passes, even with a large unstaged file.
  git('add', '-f', '--', name);
  write('unstaged.bin', Buffer.alloc(2 * 1024 * 1024));
  assert.equal(check().status, 0);
});

test('allows the exact limit and rejects oversized text as well as binary', t => {
  const { git, check, write } = repository(t);
  write('boundary.txt', 'a'.repeat(1024 * 1024));
  git('add', 'boundary.txt');
  assert.equal(check().status, 0);
  write('boundary.txt', 'a'.repeat(1024 * 1024 + 1));
  git('add', 'boundary.txt');
  assert.equal(check().status, 1);
});

test('ignores unchanged existing large assets and permits deleting them', t => {
  const { git, check, write } = repository(t);
  write('existing.bin', Buffer.alloc(2 * 1024 * 1024));
  git('add', 'existing.bin');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'existing asset');
  write('small.txt', 'small');
  git('add', 'small.txt');
  assert.equal(check().status, 0);
  git('mv', 'existing.bin', 'renamed.bin');
  assert.equal(check().status, 1);
  git('rm', '-f', 'renamed.bin');
  assert.equal(check().status, 0);
});
