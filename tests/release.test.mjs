import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { auditRelease, collectReleaseFiles, isPlainPreviewPng } from '../tools/release-check.mjs';
import { packageRoot } from '../common/runtime/paths.mjs';

test('release excludes private data but keeps the complete portable package', async () => {
  const files = await collectReleaseFiles(packageRoot);
  for (const f of ['package-lock.json', '.agents/plugins/marketplace.json', 'skills/word-maker/SKILL.md', 'common/runtime/paths.mjs']) assert.ok(files.includes(f));
  assert.ok(!files.some(f => /^(outputs|work|inputs|settings|personal-templates|node_modules|\.cache|\.codex)\//.test(f)));
  assert.equal((await auditRelease(packageRoot)).status, 'PASS');
});

test('only reviewed previews without hidden metadata can enter a release', async () => {
  const png = await readFile(path.join(packageRoot, 'examples/synthetic/previews/ppt.png'));
  assert.equal(isPlainPreviewPng(png), true);
  const chunk = Buffer.alloc(12 + 14);
  chunk.writeUInt32BE(14, 0);
  chunk.write('tEXt', 4);
  chunk.write('Hidden\0private', 8);
  const hidden = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
  assert.equal(isPlainPreviewPng(hidden), false);
  assert.equal(isPlainPreviewPng(png.subarray(0, png.length - 1)), false);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'office-preview-'));
  try {
    await mkdir(path.join(dir, 'examples/synthetic/previews'), { recursive: true });
    await writeFile(path.join(dir, 'examples/synthetic/previews/ppt.png'), hidden);
    await writeFile(path.join(dir, 'examples/synthetic/previews/customer.png'), png);
    const report = await auditRelease(dir);
    assert.ok(report.errors.some(e => e.file.endsWith('/ppt.png') && e.reason.includes('metadata')));
    assert.ok(report.errors.some(e => e.file.endsWith('/customer.png') && e.reason.includes('privacy')));
  } finally { await rm(dir, { recursive: true, force: true }); }
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
