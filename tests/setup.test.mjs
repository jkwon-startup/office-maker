import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { ensureRuntime, inspectRuntime } from '../common/runtime/setup.mjs';
import { packageRoot } from '../common/runtime/paths.mjs';

const ready = { nodeSupported: true, missing: [] };
const missing = { nodeSupported: true, missing: ['exceljs'] };

test('dependency probe ignores ancestors and detects installation in the same process', async () => {
  await mkdir(path.join(packageRoot, '.cache'), { recursive: true });
  const dir = await mkdtemp(path.join(packageRoot, '.cache/setup-probe-'));
  try {
    await writeFile(path.join(dir, 'package.json'), '{"name":"synthetic-probe"}');
    assert.deepEqual((await inspectRuntime(dir)).missing, ['pptxgenjs', 'exceljs', 'docx', 'jszip']);
    // This module is a synthetic probe fixture, not a replacement renderer.
    await mkdir(path.join(dir, 'node_modules/jszip'), { recursive: true });
    await writeFile(path.join(dir, 'node_modules/jszip/index.js'), 'module.exports = {};');
    assert.ok(!(await inspectRuntime(dir)).missing.includes('jszip'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('first-run check never installs or writes files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'office-setup-'));
  try {
    const result = await ensureRuntime({ probe: async () => missing, runner: async () => assert.fail('Unexpected install') });
    assert.equal(result.status, 'NEEDS_SETUP');
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ready runtime is reused without another installation', async () => {
  const result = await ensureRuntime({ install: true, probe: async () => ready, runner: async () => assert.fail('Unexpected install') });
  assert.equal(result.status, 'READY');
  assert.equal(result.installed, false);
});

test('authorized first-run install checks the resulting dependencies', async () => {
  let installed = false;
  const result = await ensureRuntime({ install: true, probe: async () => installed ? ready : missing,
    runner: async (args, options) => {
      assert.equal(options.cwd, packageRoot);
      assert.ok(args.includes('--ignore-scripts'));
      assert.ok(args.includes('ci'));
      installed = true;
    } });
  assert.equal(result.status, 'READY');
  assert.equal(result.installed, true);
});

test('failed or incomplete install is never reported as ready', async () => {
  await assert.rejects(ensureRuntime({ install: true, probe: async () => missing, runner: async () => { throw Error('Synthetic offline failure'); } }), /offline/);
  await assert.rejects(ensureRuntime({ install: true, probe: async () => missing, runner: async () => {} }), /still unavailable/);
});

test('unsupported Node does not attempt an installation', async () => {
  await assert.rejects(ensureRuntime({ install: true, probe: async () => ({ nodeSupported: false, missing: [] }), runner: async () => assert.fail('Unexpected install') }), /Node.js 20/);
});

test('read-only package can be copied to an explicit private runtime without customer files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'office-setup-copy-'));
  const dest = path.join(dir, 'runtime with spaces');
  try {
    let installed = false;
    const result = await ensureRuntime({ dest, install: true, probe: async () => installed ? ready : missing,
      runner: async (_args, options) => { assert.equal(options.cwd, dest); installed = true; } });
    assert.equal(result.root, dest);
    assert.equal(JSON.parse(await readFile(path.join(dest, 'package.json'), 'utf8')).name, 'office-maker');
    assert.ok(!(await readdir(dest)).some(f => ['outputs', 'work', 'inputs', '.git', 'node_modules', '.cache'].includes(f)));
    await assert.rejects(ensureRuntime({ dest, install: true }), /already exists/);
    await assert.rejects(ensureRuntime({ dest: path.join(packageRoot, 'skills', 'unexpected'), install: true }), /source/);
    await assert.rejects(ensureRuntime({ dest: 'relative', install: true }), /absolute/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
