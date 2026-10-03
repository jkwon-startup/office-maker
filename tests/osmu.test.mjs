import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { assertOutputPath, packageRoot, parseArgs } from '../common/runtime/paths.mjs';
import { runPipeline, planOutputs } from '../skills/osmu-maker/scripts/run.mjs';
import { resolveTemplate } from '../common/runtime/doctor.mjs';
import { createAlias } from '../tools/create-alias.mjs';

const content = { topic: 'Synthetic workshop', summary: 'Synthetic content only.', keyPoints: ['Plan one small improvement.'], nextAction: 'Review the practice.', sources: [{ id: 'S1', title: 'Synthetic source' }] };

test('customer output cannot overwrite skill sources', () => {
  assert.throws(() => assertOutputPath(path.join(packageRoot, 'skills/result.pptx'), '.pptx'));
});
test('an explicit result directory is accepted', () => {
  assert.equal(assertOutputPath(path.join(packageRoot, 'outputs/result.pptx'), '.pptx'), path.join(packageRoot, 'outputs/result.pptx'));
});
test('CLI rejects missing values and unknown flags', () => {
  assert.throws(() => parseArgs(['--input']));
  assert.throws(() => parseArgs(['--unknown']));
});

test('dry-run retains sources in three purpose-specific plans', async () => {
  const result = await runPipeline(content, { dryRun: true });
  assert.equal(result.status, 'PLANNED');
  assert.equal(result.plans.ppt.slides.length, 3);
  assert.match(result.plans.ppt.slides[0].notes, /Synthetic source/);
  assert.equal(result.plans.excel.sheets[1].name, 'Sources');
  assert.equal(result.plans.word.sections.at(-1).heading, 'Source material');
  assert.equal(result.plans.excel.sheets[0].rows[0].owner, null);
});

test('dry-run rejects invalid explicit plans and changed canonical sources', async () => {
  await assert.rejects(runPipeline({ ...content, workbook: { title: 'Bad', sheets: [] } }, { dryRun: true }));
  assert.throws(() => planOutputs({ ...content, slides: { title: 'Bad', sources: [], slides: [] } }));
});

test('pipeline isolates a failure, resumes successful outputs and checks content hashes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'office-maker-test-'));
  const options = { output: path.join(dir, 'outputs'), runDir: path.join(dir, 'work') };
  let calls = { ppt: 0, excel: 0, word: 0 };
  const generator = format => async () => { calls[format]++; return { bytes: Buffer.from('synthetic-' + format), report: { status: 'WARN' } }; };
  try {
    const first = await runPipeline(content, { ...options, generators: { ppt: generator('ppt'), excel: async () => { throw new Error('test failure'); }, word: generator('word') } });
    assert.equal(first.status, 'PARTIAL');
    const second = await runPipeline(content, { ...options, generators: Object.fromEntries(['ppt', 'excel', 'word'].map(f => [f, generator(f)])) });
    assert.equal(second.status, 'COMPLETE');
    assert.deepEqual(calls, { ppt: 1, excel: 1, word: 1 });
    await assert.rejects(runPipeline({ ...content, summary: 'Changed source' }, options), /Checkpoint content differs/);
    await writeFile(path.join(options.output, 'ppt.pptx'), 'changed');
    const third = await runPipeline(content, { ...options, generators: Object.fromEntries(['ppt', 'excel', 'word'].map(f => [f, generator(f)])) });
    assert.equal(third.status, 'PARTIAL');
    assert.equal(third.results.ppt.status, 'FAILED');
    assert.match(third.results.ppt.error, /Output exists/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const failedFormat of ['ppt', 'excel', 'word']) {
  test('repeated ' + failedFormat + ' recovery retains every successful checkpoint entry', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'office-maker-recovery-test-'));
    const options = { output: path.join(dir, 'outputs'), runDir: path.join(dir, 'work') };
    const formats = ['ppt', 'excel', 'word'];
    const calls = { ppt: 0, excel: 0, word: 0 };
    const generators = Object.fromEntries(formats.map(format => [format, async () => {
      calls[format]++;
      if (format === failedFormat && calls[format] <= 2) throw new Error('Synthetic retry failure');
      return { bytes: Buffer.from('synthetic-' + format), report: { status: 'WARN' } };
    }]));
    const checkpoint = async () => JSON.parse(await readFile(path.join(options.runDir, 'checkpoint.json'), 'utf8'));
    try {
      const first = await runPipeline(content, { ...options, generators });
      assert.equal(first.status, 'PARTIAL');
      const successful = formats.filter(format => format !== failedFormat);
      const againFailed = await runPipeline(content, { ...options, generators });
      assert.equal(againFailed.status, 'PARTIAL');
      const failedCheckpoint = await checkpoint();
      for (const format of successful) {
        assert.deepEqual(failedCheckpoint.results[format], first.results[format]);
        assert.equal(calls[format], 1);
      }
      const recovered = await runPipeline(content, { ...options, generators });
      assert.equal(recovered.status, 'COMPLETE');
      const saved = await checkpoint();
      assert.deepEqual(saved.results, recovered.results);
      for (const format of successful) assert.deepEqual(recovered.results[format], first.results[format]);
      const counts = { ...calls };
      for (let repeat = 0; repeat < 2; repeat++) {
        const resumed = await runPipeline(content, { ...options, generators });
        assert.equal(resumed.status, 'COMPLETE');
        assert.deepEqual(resumed.results, recovered.results);
        assert.deepEqual(calls, counts);
        assert.deepEqual((await checkpoint()).results, recovered.results);
      }
      assert.equal(calls[failedFormat], 3);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

test('private template IDs, names and versions resolve independently of ordering', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'office-maker-template-test-'));
  const library = path.join(dir, 'index.json');
  const ready = { id: 'W002', name: 'Synthetic design', version: '1.0.0', status: 'ready', modes: ['design_system'], design: { font: 'Arial', bodyPt: 11 }, checks: { privacy: 'passed', visual: 'passed', compatibility: 'passed' } };
  try {
    await writeFile(library, JSON.stringify({ schemaVersion: '1.0', templates: [{ ...ready, version: '2.0.0' }, ready, { ...ready, id: 'W001', name: 'Draft design', status: 'draft' }] }));
    assert.equal((await resolveTemplate('word', { id: '2', library })).version, '2.0.0');
    assert.equal((await resolveTemplate('word', { id: 'Synthetic design', version: '1.0.0', library })).version, '1.0.0');
    await assert.rejects(resolveTemplate('word', { id: '1', library }), /pending/);
    await assert.rejects(resolveTemplate('word', { id: '3', library }), /not registered/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('personal alias dry-run validates names and prevents public package writes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'office-maker-alias-test-'));
  try {
    const plan = await createAlias({ name: 'my-ppt', target: 'ppt-maker', dest: dir, dryRun: true });
    assert.equal(plan.status, 'PLANNED');
    assert.equal(plan.files.length, 2);
    await assert.rejects(readFile(plan.files[0]), { code: 'ENOENT' });
    const created = await createAlias({ name: 'my-ppt', target: 'ppt-maker', dest: dir });
    assert.match(await readFile(created.files[0], 'utf8'), /name: my-ppt/);
    assert.match(await readFile(created.files[1], 'utf8'), /allow_implicit_invocation: false/);
    await assert.rejects(createAlias({ name: 'my-ppt', target: 'ppt-maker', dest: dir }), /already exists/);
    await assert.rejects(createAlias({ name: '../bad', target: 'ppt-maker', dest: dir, dryRun: true }));
    await assert.rejects(createAlias({ name: 'my-ppt', target: 'ppt-maker', dest: path.join(packageRoot, 'outputs'), dryRun: true }));
    const linked = path.join(dir, 'linked');
    await symlink(packageRoot, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(createAlias({ name: 'my-ppt', target: 'ppt-maker', dest: path.join(linked, 'outputs'), dryRun: true }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
