import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { runPipeline } from '../skills/osmu-maker/scripts/run.mjs';
import { packageRoot } from '../common/runtime/paths.mjs';
import { loadDependency, resolveTemplate } from '../common/runtime/doctor.mjs';
import { generatePresentation } from '../skills/ppt-maker/scripts/generate.mjs';
import { generateWorkbook } from '../skills/excel-maker/scripts/generate.mjs';
import { generateDocument } from '../skills/word-maker/scripts/generate.mjs';

test('real OSMU outputs open, preserve content and resume without rewriting', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'office-osmu-real-'));
  const content = JSON.parse(await readFile(path.join(packageRoot, 'examples/synthetic/input.json'), 'utf8'));
  const options = { output: path.join(dir, 'outputs'), runDir: path.join(dir, 'work') };
  try {
    const result = await runPipeline(content, options);
    assert.equal(result.status, 'COMPLETE');
    const JSZip = loadDependency('jszip');
    const ppt = await JSZip.loadAsync(await readFile(result.results.ppt.output));
    assert.equal(ppt.file(/^ppt\/slides\/slide\d+\.xml$/).length, (content.slides?.slides.length ?? content.keyPoints.length + 2));
    assert.equal(ppt.file(/^ppt\/notesSlides\/notesSlide\d+\.xml$/).length, (content.slides?.slides.length ?? content.keyPoints.length + 2));
    const doc = await JSZip.loadAsync(await readFile(result.results.word.output));
    assert.match(await doc.file('word/document.xml').async('string'), new RegExp(content.topic));
    const ExcelJS = loadDependency('exceljs'); const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.results.excel.output);
    assert.equal(workbook.worksheets[0].getCell('A2').value, (content.workbook?.sheets[0].rows[0][content.workbook.sheets[0].columns[0].key] ?? content.keyPoints[0]));
    const before = await Promise.all(Object.values(result.results).map(r => stat(r.output)));
    const resumed = await runPipeline(content, options);
    assert.deepEqual(resumed.results, result.results);
    const after = await Promise.all(Object.values(result.results).map(r => stat(r.output)));
    assert.deepEqual(after.map(s => s.mtimeMs), before.map(s => s.mtimeMs));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// Synthetic reviewed-state fixtures test selection; they certify no real template.
const checks = { privacy: 'passed', visual: 'passed', compatibility: 'passed' };
for (const kind of ['ppt', 'excel', 'word']) {
  test(kind + ' selects a named or numbered profile and applies it to a real file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'office-profile-'));
    const prefix = { ppt: 'T', excel: 'E', word: 'W' }[kind];
    const library = path.join(dir, 'index.json');
    const design = kind === 'ppt' ? {
      colors: { background: '#FFFFFF', heading: '#335577', text: '#222222', accent: '#20746A', muted: '#666666' },
      fonts: { heading: 'Arial', body: 'Arial', fallbacks: ['sans-serif'] },
      typography: { titlePt: 28, bodyPt: 18, captionPt: 9 }, spacing: { marginX: 0.05, marginY: 0.05, gap: 0.02 }, shapeStyle: 'square'
    } : kind === 'excel' ? { font: 'Arial', bodyPt: 12, headerColor: '#335577', columnWidth: 26, orientation: 'landscape' }
      : { font: 'Arial', bodyPt: 12, headingColor: '#335577', page: { size: 'A4', orientation: 'landscape' } };
    const ready = { id: prefix + '002', name: 'Synthetic second', version: '1.0.0', status: 'ready', modes: ['design_system'], design, checks };
    if (kind === 'ppt') Object.assign(ready, { origin: 'generated', aspectRatio: '4:3', layouts: [{ id: 'body', kind: 'body', regions: [{ role: 'title', x: 0.05, y: 0.05, w: 0.9, h: 0.12 }] }] });
    try {
      const other = { ...ready, id: prefix + '001', name: 'Synthetic draft', status: 'draft' };
      await writeFile(library, JSON.stringify({ schemaVersion: '1.0', templates: [other, ready] }));
      const selection = { id: '2', version: '1.0.0', library };
      assert.equal((await resolveTemplate(kind, selection)).id, ready.id);
      assert.equal((await resolveTemplate(kind, { id: ready.name, library })).id, ready.id);
      await assert.rejects(resolveTemplate(kind, { id: '1', library }), /pending/);
      await assert.rejects(resolveTemplate(kind, { id: '3', library }), /not registered/);
      let result;
      if (kind === 'ppt') {
        result = await generatePresentation({ title: 'Profile test', template: selection, sources: [], slides: [
          { id: 'start', layout: 'title', title: 'Profile test', notes: 'Synthetic introduction' },
          { id: 'one', layout: 'body', title: 'Profile test', bullets: [{ text: 'Synthetic content' }], notes: 'Synthetic notes' },
          { id: 'end', layout: 'closing', title: 'Review', notes: 'Synthetic closing' }
        ] });
        const zip = await loadDependency('jszip').loadAsync(result.bytes);
        assert.match(await zip.file('ppt/slides/slide2.xml').async('string'), /335577/);
        assert.match(await zip.file('ppt/presentation.xml').async('string'), /cx="9144000"/);
      } else if (kind === 'excel') {
        result = await generateWorkbook({ title: 'Profile test', template: selection, sheets: [{ name: 'Test', columns: [{ key: 'value', header: 'Value' }], rows: [{ value: 2 }, { value: { formula: 'A2*2' } }] }] });
        const ExcelJS = loadDependency('exceljs'); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(result.bytes);
        assert.equal(workbook.worksheets[0].getCell('A1').fill.fgColor.argb.slice(-6), '335577');
        assert.equal(workbook.worksheets[0].getCell('A3').formula, 'A2*2');
        assert.equal(workbook.worksheets[0].pageSetup.orientation, 'landscape');
      } else {
        result = await generateDocument({ title: 'Profile test', template: selection, sections: [{ heading: 'Summary', paragraphs: ['Synthetic content'] }] });
        const zip = await loadDependency('jszip').loadAsync(result.bytes);
        assert.match(await zip.file('word/document.xml').async('string'), /w:orient="landscape"/);
      }
      assert.deepEqual(result.report.template, { id: ready.id, version: '1.0.0' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
