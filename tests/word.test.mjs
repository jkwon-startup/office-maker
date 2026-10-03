import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateDocument, validateDocumentDesign, applyReportTemplate } from '../skills/word-maker/scripts/validate.mjs';
import { generateDocument } from '../skills/word-maker/scripts/generate.mjs';
import { available, loadDependency } from '../common/runtime/doctor.mjs';

export const document = { title: 'Synthetic document', sections: [
  { heading: 'Overview', paragraphs: ['Synthetic content only.'], table: { headers: ['Item', 'Value'], rows: [['Sample', 2]] } }
] };
const reportTemplate = {
  design: { font: 'Arial', bodyPt: 11 },
  report: { sections: [
    { id: 'purpose', heading: 'Purpose', level: 1, required: true },
    { id: 'results', heading: 'Results', level: 2, required: true, tableHeaders: ['Item', 'Value'] }
  ] }
};
const reportPlan = { title: 'Synthetic report', sections: [
  { templateSectionId: 'results', heading: 'Results', paragraphs: ['Synthetic findings.'], table: { headers: ['Item', 'Value'], rows: [['Sample', 2]] } },
  { templateSectionId: 'purpose', heading: 'Purpose', paragraphs: ['Synthetic purpose.'] }
] };

test('report template orders sections without changing the input', () => {
  const result = applyReportTemplate(reportPlan, reportTemplate);
  assert.deepEqual(result.sections.map(s => s.heading), ['Purpose', 'Results']);
  assert.equal(result.sections[1].level, 2);
  assert.equal(reportPlan.sections[0].heading, 'Results');
});
test('report template rejects missing required sections and wrong table headers', () => {
  assert.throws(() => applyReportTemplate({ ...reportPlan, sections: [reportPlan.sections[0]] }, reportTemplate), /required/);
  const p = structuredClone(reportPlan); p.sections[0].table.headers = ['Other', 'Value'];
  assert.throws(() => applyReportTemplate(p, reportTemplate), /headers/);
});
test('report template rejects unknown, duplicate or renamed section mappings', () => {
  const p = structuredClone(reportPlan); p.sections[0].templateSectionId = 'unknown';
  assert.throws(() => applyReportTemplate(p, reportTemplate), /Unknown/);
  assert.throws(() => applyReportTemplate({ ...reportPlan, sections: [reportPlan.sections[1], reportPlan.sections[1]] }, reportTemplate), /Duplicate/);
  p.sections[0].templateSectionId = 'results'; p.sections[0].heading = 'Renamed';
  assert.throws(() => applyReportTemplate(p, reportTemplate), /heading/);
});
test('required report sections cannot be empty', () => {
  const p = structuredClone(reportPlan); p.sections[1].paragraphs = ['   '];
  assert.throws(() => applyReportTemplate(p, reportTemplate), /no content/);
});
test('unsupported page settings and invalid design values fail preflight', () => {
  for (const design of [{ page: { size: 'A3' } }, { page: { orientation: 'sideways' } }, { page: { marginMm: { left: -1 } } }, { lineSpacing: 0 }, { headingColor: 'red' }]) {
    assert.equal(validateDocumentDesign(design).status, 'FAIL');
  }
  assert.equal(validateDocumentDesign({ page: { size: 'LETTER', orientation: 'portrait', marginMm: { left: 20 } }, lineSpacing: 1.5 }).status, 'PASS');
});
test('document sections and table shape pass', () => assert.equal(validateDocument(document).status, 'PASS'));
test('table width mismatch is rejected', () => {
  const p = structuredClone(document); p.sections[0].table.rows[0] = ['Only one cell'];
  assert.equal(validateDocument(p).status, 'FAIL');
});

test('malformed table headers fail without crashing', () => {
  const p = structuredClone(document); delete p.sections[0].table.headers;
  assert.equal(validateDocument(p).status, 'FAIL');
});

test('generated DOCX preserves editable paragraphs and tables', { skip: !process.env.CI && (!available('docx') || !available('jszip')) }, async () => {
  const { bytes, report } = await generateDocument(document);
  assert.equal(report.status, 'WARN');
  const zip = await loadDependency('jszip').loadAsync(bytes);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /Synthetic content only/);
  assert.match(xml, /<w:tbl>/);
  assert.match(xml, /<w:t/);
});

test('selected report profile controls DOCX order, page design, headings and table continuation', { skip: !process.env.CI && (!available('docx') || !available('jszip')) }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'office-word-test-'));
  try {
    const library = path.join(dir, 'registry.json');
    const template = { ...reportTemplate, id: 'W001', name: 'Synthetic report profile', version: '1.0.0', status: 'ready', modes: ['design_system'], checks: { privacy: 'passed', visual: 'passed', compatibility: 'passed' }, design: {
      font: 'Arial', bodyPt: 11, headingFont: 'Arial', headingPt: 18, titlePt: 26,
      headingColor: '#234567', tableHeaderColor: '#CCDDEE', lineSpacing: 1.5, paragraphAfterPt: 10,
      page: { size: 'A4', orientation: 'landscape', marginMm: { top: 15, right: 18, bottom: 15, left: 18 } }
    } };
    template.report = structuredClone(template.report);
    template.report.sections[1].pageBreakBefore = true;
    await writeFile(library, JSON.stringify({ schemaVersion: '1.0', templates: [template] }));
    const plan = structuredClone(reportPlan);
    plan.template = { id: 'W001', version: '1.0.0', library };
    plan.sections[1].bullets = ['Synthetic action.'];
    const { bytes, report } = await generateDocument(plan);
    assert.deepEqual(report.template, { id: 'W001', version: '1.0.0' });
    assert.equal(report.status, 'WARN');
    const zip = await loadDependency('jszip').loadAsync(bytes);
    const xml = await zip.file('word/document.xml').async('string');
    const styles = await zip.file('word/styles.xml').async('string');
    assert.ok(xml.indexOf('Purpose') < xml.indexOf('Results'));
    assert.match(xml, /w:pStyle w:val="Heading2"/);
    assert.match(xml, /w:pageBreakBefore/);
    assert.match(xml, /<w:pgSz[^>]*w:w="16838"[^>]*w:h="11906"[^>]*w:orient="landscape"/);
    assert.match(xml, /<w:pgMar[^>]*w:top="850"/);
    assert.match(xml, /<w:pgMar[^>]*w:left="1020"/);
    assert.match(xml, /<w:tblHeader/);
    assert.match(xml, /<w:cantSplit/);
    assert.match(xml, /<w:numPr/);
    assert.match(xml, /w:fill="CCDDEE"/);
    assert.match(styles, /w:color w:val="234567"/);
    assert.match(styles, /w:sz w:val="36"/);
    assert.match(styles, /w:line="360"/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
