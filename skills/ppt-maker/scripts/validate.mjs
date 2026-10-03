import { loadDependency } from '../../../common/runtime/doctor.mjs';
import { newReport } from '../../../common/runtime/paths.mjs';

export const layouts = ['title', 'body', 'comparison', 'roadmap', 'kpi', 'closing'];

export function validateSlides(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return newReport('ppt', ['Invalid presentation plan']);
  if (typeof plan.title !== 'string' || !plan.title.trim()) errors.push('Presentation title is required');
  if (!Array.isArray(plan.slides) || plan.slides.length < 2) errors.push('At least two slides are required');
  const slides = Array.isArray(plan.slides) ? plan.slides : [];
  if (slides.length && slides[0]?.layout !== 'title') errors.push('First slide must use title');
  if (slides.length && slides.at(-1)?.layout !== 'closing') errors.push('Last slide must use closing');
  if (plan.slideCount !== undefined && plan.slideCount !== slides.length) errors.push('Slide count mismatch');
  const ids = new Set();
  const sourceIds = new Set((Array.isArray(plan.sources) ? plan.sources : []).map(s => s?.id));
  if (plan.sources !== undefined && (!Array.isArray(plan.sources) || plan.sources.some(s => typeof s?.id !== 'string' || !s.id || typeof s.title !== 'string' || !s.title) || sourceIds.size !== plan.sources.length)) errors.push('Invalid or duplicate source records');
  if (plan.notes !== undefined && typeof plan.notes !== 'boolean') errors.push('Invalid notes setting');
  for (const [i, slide] of slides.entries()) {
    if (!slide || typeof slide !== 'object') { errors.push('Invalid slide ' + (i + 1)); continue; }
    if (typeof slide.id !== 'string' || !slide.id || ids.has(slide.id)) errors.push('Missing or duplicate slide ID');
    ids.add(slide.id);
    if (!layouts.includes(slide.layout)) errors.push('Unsupported layout: ' + slide.layout);
    if (typeof slide.title !== 'string' || !slide.title.trim()) errors.push('Slide title is required');
    if (plan.notes !== false && (typeof slide.notes !== 'string' || !slide.notes.trim())) errors.push('Speaker notes are required');
    const groups = [slide.bullets, slide.left?.bullets, slide.right?.bullets].filter(v => v !== undefined);
    for (const group of groups) {
      if (!Array.isArray(group)) { errors.push('Invalid bullets'); continue; }
      for (const bullet of group) {
        if (!bullet || typeof bullet.text !== 'string' || !bullet.text.trim() || bullet.text.length > 60) errors.push('Invalid or overlong bullet');
        if (bullet?.label !== undefined && (typeof bullet.label !== 'string' || bullet.label.length > 30)) errors.push('Invalid bullet label');
      }
    }
    if (slide.layout === 'comparison' && [slide.left, slide.right].some(half => typeof half?.heading !== 'string' || !half.heading.trim())) errors.push('Comparison headings are required');
    if (slide.layout === 'roadmap' && (!Array.isArray(slide.stages) || slide.stages.length < 2 || slide.stages.length > 5)) errors.push('Roadmap requires 2–5 stages');
    if (Array.isArray(slide.stages) && slide.stages.some(s => typeof s?.name !== 'string' || !s.name.trim() || ['timing', 'owner', 'deliverable'].some(k => s[k] !== undefined && typeof s[k] !== 'string'))) errors.push('Invalid roadmap stage');
    if (slide.layout === 'kpi' && (!Array.isArray(slide.metrics) || !slide.metrics.length || slide.metrics.length > 3)) errors.push('KPI requires 1–3 metrics');
    if (Array.isArray(slide.metrics) && slide.metrics.some(m => typeof m?.name !== 'string' || !m.name.trim() || !['fact', 'target', 'assumption'].includes(m.status) || (m.value === undefined && (typeof m.method !== 'string' || !m.method.trim())) || (m.value !== undefined && !['string', 'number'].includes(typeof m.value)))) errors.push('Invalid KPI metric or missing fact/target/assumption label');
    if (slide.sources !== undefined && !Array.isArray(slide.sources)) errors.push('Invalid source IDs');
    for (const id of Array.isArray(slide.sources) ? slide.sources : []) if (!sourceIds.has(id)) errors.push('Unknown source ID: ' + id);
    if (slide.seconds !== undefined && (!Number.isFinite(slide.seconds) || slide.seconds <= 0)) errors.push('Invalid slide duration');
  }
  if (plan.durationSeconds !== undefined) {
    const total = slides.reduce((sum, slide) => sum + (slide?.seconds || 0), 0);
    if (total !== plan.durationSeconds) errors.push('Presentation time mismatch');
  }
  return newReport('ppt', errors);
}

export async function inspectPptx(bytes, plan) {
  const JSZip = loadDependency('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files);
  const count = files.filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  const notes = files.filter(name => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).length;
  const errors = [];
  if (count !== plan.slides.length) errors.push('Actual slide count mismatch');
  if (plan.notes !== false && notes !== count) errors.push('Actual notes count mismatch');
  if (!zip.file('[Content_Types].xml') || !zip.file('ppt/presentation.xml')) errors.push('Invalid PPTX package');
  return { ...newReport('ppt', errors, ['Visual review not performed']), createdSlides: count, notesWritten: notes };
}
