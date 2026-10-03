import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSlides } from '../skills/ppt-maker/scripts/validate.mjs';
import { generatePresentation } from '../skills/ppt-maker/scripts/generate.mjs';
import { available, loadDependency } from '../common/runtime/doctor.mjs';

export const presentation = {
  title: 'Synthetic presentation', slideCount: 3, sources: [{ id: 'S1', title: 'Synthetic material' }],
  slides: [
    { id: 's1', layout: 'title', title: 'Synthetic presentation', notes: 'Introduce the synthetic example.' },
    { id: 's2', layout: 'body', title: 'Main point', bullets: [{ label: 'Point', text: 'Synthetic content only' }], sources: ['S1'], notes: 'Explain the example.' },
    { id: 's3', layout: 'closing', title: 'Next action', notes: 'Close the example.' }
  ]
};

test('valid presentation data passes', () => assert.equal(validateSlides(presentation).status, 'PASS'));
test('missing source ID is rejected', () => {
  const p = structuredClone(presentation); p.slides[1].sources = ['S404'];
  assert.equal(validateSlides(p).status, 'FAIL');
});
test('comparison bullets and missing notes are validated', () => {
  const p = structuredClone(presentation);
  p.slides[1] = { id: 's2', layout: 'comparison', title: 'Compare', notes: '', left: { heading: 'Before', bullets: [{ text: 'x'.repeat(61) }] }, right: { heading: 'After', bullets: [] } };
  assert.ok(validateSlides(p).errors.length >= 2);
});

test('malformed slides fail without crashing', () => {
  assert.equal(validateSlides({ title: 'Synthetic', slides: [null, null] }).status, 'FAIL');
});

test('generated PPTX preserves editable text and speaker notes', { skip: !process.env.CI && (!available('pptxgenjs') || !available('jszip')) }, async () => {
  const { bytes, report } = await generatePresentation(presentation);
  assert.equal(report.createdSlides, 3);
  assert.equal(report.notesWritten, 3);
  assert.equal(report.status, 'WARN');
  const zip = await loadDependency('jszip').loadAsync(bytes);
  const xml = await zip.file('ppt/slides/slide2.xml').async('string');
  const notes = await zip.file('ppt/notesSlides/notesSlide2.xml').async('string');
  assert.match(xml, /Synthetic content only/);
  assert.match(xml, /<a:t>/);
  assert.match(notes, /Explain the example/);
  assert.match(notes, /Synthetic material/);
});

test('title subtitle appears once in the editable slide', async () => {
  const p = structuredClone(presentation); p.slides[0].subtitle = 'A clear introduction';
  const { bytes } = await generatePresentation(p);
  const zip = await loadDependency('jszip').loadAsync(bytes);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.equal(xml.split('A clear introduction').length - 1, 1);
});

test('Korean KPI slides show reader-facing assumption labels', async () => {
  const { generatePresentation } = await import('../skills/ppt-maker/scripts/generate.mjs');
  const { loadDependency } = await import('../common/runtime/doctor.mjs');
  const plan = structuredClone(presentation);
  plan.language = 'ko-KR';
  plan.slides[1] = { id: 'metrics', layout: 'kpi', title: '검토 지표', metrics: [{ name: '가상 소요 시간', value: 30, unit: '분', status: 'assumption' }], notes: '가상 입력으로 실제 성과가 아닙니다.' };
  const result = await generatePresentation(plan);
  const zip = await loadDependency('jszip').loadAsync(result.bytes);
  const xml = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(xml, /가정/);
  assert.doesNotMatch(xml, /assumption/);
});
