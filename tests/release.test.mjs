import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { auditRelease, collectReleaseFiles } from '../tools/release-check.mjs';
import { packageRoot } from '../common/runtime/paths.mjs';

test('release excludes private data but keeps the complete portable package', async () => {
  const files = await collectReleaseFiles(packageRoot);
  for (const f of ['package-lock.json', '.agents/plugins/marketplace.json', 'skills/word-maker/SKILL.md', 'common/runtime/paths.mjs']) assert.ok(files.includes(f));
  assert.ok(!files.some(f => /^(outputs|work|inputs|settings|personal-templates|node_modules|\.cache|\.codex)\//.test(f)));
  assert.equal((await auditRelease(packageRoot)).status, 'PASS');
});

test('release audit reports private paths without echoing their contents', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'office-release-'));
  try {
    await writeFile(path.join(dir, 'README.md'), '/Users/' + 'synthetic-account/private.md');
    const report = await auditRelease(dir);
    assert.equal(report.status, 'FAIL');
    assert.ok(report.errors.some(e => e.file === 'README.md' && e.reason === 'Personal path or contact marker'));
    assert.doesNotMatch(JSON.stringify(report), /synthetic-account/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('release collection rejects linked source directories', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'office-release-link-'));
  try {
    await mkdir(path.join(dir, 'outside'));
    await symlink(path.join(dir, 'outside'), path.join(dir, 'skills'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(collectReleaseFiles(dir), /symlink/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
