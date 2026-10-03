import { loadDependency } from '../../../common/runtime/doctor.mjs';
import { newReport } from '../../../common/runtime/paths.mjs';

export function validateDocument(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return newReport('word', ['Invalid document plan']);
  if (typeof plan.title !== 'string' || !plan.title.trim()) errors.push('Document title is required');
  if (!Array.isArray(plan.sections) || !plan.sections.length) errors.push('Sections are required');
  for (const section of Array.isArray(plan.sections) ? plan.sections : []) {
    if (!section || typeof section.heading !== 'string' || !section.heading.trim()) errors.push('Section heading is required');
    if (!Array.isArray(section?.paragraphs) || section.paragraphs.some(p => typeof p !== 'string')) errors.push('Paragraphs must be strings');
    if (section?.bullets !== undefined && (!Array.isArray(section.bullets) || section.bullets.some(p => typeof p !== 'string' || !p.trim()))) errors.push('Bullet items must be nonempty strings');
    if (section?.pageBreakBefore !== undefined && typeof section.pageBreakBefore !== 'boolean') errors.push('Invalid section page break');
    if (section?.level !== undefined && (![1, 2, 3].includes(section.level))) errors.push('Heading level must be 1, 2 or 3');
    if (section?.templateSectionId !== undefined && (typeof section.templateSectionId !== 'string' || !section.templateSectionId.trim())) errors.push('Invalid template section ID');
    if (section?.table) {
      const table = section.table;
      if (!Array.isArray(table.headers) || !table.headers.length || table.headers.some(v => typeof v !== 'string')) errors.push('Table headers are required');
      if (!Array.isArray(table.rows) || !Array.isArray(table.headers) || table.rows.some(row => !Array.isArray(row) || row.length !== table.headers.length || row.some(v => (typeof v === 'number' && !Number.isFinite(v)) || (!['string', 'number', 'boolean'].includes(typeof v) && v !== null)))) errors.push('Table row shape mismatch');
    }
  }
  return newReport('word', errors);
}

export function validateDocumentDesign(design = {}) {
  const errors = [];
  if (!design || typeof design !== 'object' || Array.isArray(design)) return newReport('word', ['Invalid document design']);
  for (const key of ['font', 'headingFont']) if (design[key] !== undefined && (typeof design[key] !== 'string' || !design[key].trim())) errors.push('Invalid design font');
  for (const [key, minimum, maximum] of [['bodyPt', 6, 36], ['headingPt', 8, 72], ['titlePt', 8, 72], ['lineSpacing', 1, 3], ['paragraphAfterPt', 0, 36]]) {
    if (design[key] !== undefined && (!Number.isFinite(design[key]) || design[key] < minimum || design[key] > maximum)) errors.push('Invalid design value: ' + key);
  }
  for (const key of ['headingColor', 'tableHeaderColor']) if (design[key] !== undefined && !/^#[0-9a-fA-F]{6}$/.test(design[key])) errors.push('Invalid design color');
  if (design.page !== undefined) {
    const page = design.page;
    if (!page || typeof page !== 'object' || Array.isArray(page)) errors.push('Invalid page design');
    else {
      if (page.size !== undefined && !['A4', 'LETTER'].includes(page.size)) errors.push('Unsupported page size');
      if (page.orientation !== undefined && !['portrait', 'landscape'].includes(page.orientation)) errors.push('Unsupported page orientation');
      if (page.marginMm !== undefined) {
        const margin = page.marginMm;
        if (!margin || typeof margin !== 'object' || Array.isArray(margin) || Object.keys(margin).some(k => !['top', 'right', 'bottom', 'left'].includes(k)) || Object.values(margin).some(v => !Number.isFinite(v) || v < 0 || v > 60)) errors.push('Invalid page margins');
      }
    }
  }
  return newReport('word', errors);
}

export function applyReportTemplate(plan, template) {
  const result = structuredClone(plan);
  const outline = template?.report?.sections;
  if (outline === undefined) return result;
  if (!Array.isArray(outline) || !outline.length) throw new Error('Invalid report template outline');
  const known = new Map();
  for (const section of outline) {
    if (typeof section?.id !== 'string' || !section.id.trim() || known.has(section.id) || typeof section.heading !== 'string' || !section.heading.trim() || (section.level !== undefined && ![1, 2, 3].includes(section.level)) || typeof section.required !== 'boolean' || (section.pageBreakBefore !== undefined && typeof section.pageBreakBefore !== 'boolean')) throw new Error('Invalid or duplicate report template section');
    if (section.tableHeaders !== undefined && (!Array.isArray(section.tableHeaders) || !section.tableHeaders.length || section.tableHeaders.some(h => typeof h !== 'string' || !h.trim()))) throw new Error('Invalid report template table headers');
    known.set(section.id, section);
  }
  const supplied = new Map();
  for (const section of result.sections) {
    const id = section.templateSectionId;
    if (!known.has(id)) throw new Error('Unknown or missing template section mapping');
    if (supplied.has(id)) throw new Error('Duplicate template section mapping');
    const definition = known.get(id);
    if (section.heading !== definition.heading) throw new Error('Report heading differs from the selected template');
    if (section.level !== undefined && section.level !== (definition.level || 1)) throw new Error('Report heading level differs from the selected template');
    if (definition.tableHeaders && JSON.stringify(section.table?.headers) !== JSON.stringify(definition.tableHeaders)) throw new Error('Report table headers differ from the selected template');
    if (definition.required && !section.paragraphs?.some(p => p.trim()) && !section.bullets?.length && !section.table?.rows?.length) throw new Error('A required report section has no content');
    section.level = definition.level || 1;
    if (definition.pageBreakBefore !== undefined) section.pageBreakBefore = definition.pageBreakBefore;
    supplied.set(id, section);
  }
  for (const definition of outline) if (definition.required && !supplied.has(definition.id)) throw new Error('A required report template section is missing');
  result.sections = outline.filter(s => supplied.has(s.id)).map(s => supplied.get(s.id));
  return result;
}

export async function inspectDocx(bytes) {
  const JSZip = loadDependency('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const errors = [];
  if (!zip.file('[Content_Types].xml') || !zip.file('word/document.xml')) errors.push('Invalid DOCX package');
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml || !xml.includes('<w:t')) errors.push('Document text missing');
  return newReport('word', errors, ['Page layout and visual review not performed']);
}
