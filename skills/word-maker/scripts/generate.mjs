import { loadDependency, resolveTemplate } from '../../../common/runtime/doctor.mjs';
import { isMain, parseArgs, readJson, writeArtifact } from '../../../common/runtime/paths.mjs';
import { validateDocument, validateDocumentDesign, applyReportTemplate, inspectDocx } from './validate.mjs';

export async function generateDocument(plan) {
  const check = validateDocument(plan);
  if (check.status === 'FAIL') throw new Error(check.errors.join('; '));
  if (plan.mode && plan.mode !== 'design_system') throw new Error('Original DOCX structure reuse is not implemented.');
  const template = await resolveTemplate('word', plan.template);
  plan = applyReportTemplate(plan, template);
  const { Document, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, Packer, WidthType, PageOrientation, ShadingType } = loadDependency('docx');
  const design = template?.design || {};
  const designCheck = validateDocumentDesign(design);
  if (designCheck.status === 'FAIL') throw new Error(designCheck.errors.join('; '));
  const font = design.font || 'Arial';
  const headingFont = design.headingFont || font;
  const bodyPt = design.bodyPt || 11;
  const after = Math.round((design.paragraphAfterPt ?? 8) * 20);
  const line = Math.round((design.lineSpacing || 1.15) * 240);
  const headingColor = (design.headingColor || '#18324A').slice(1);
  const headingStyle = size => ({ run: { font: headingFont, size: size * 2, bold: true, color: headingColor }, paragraph: { keepNext: true, spacing: { before: 180, after, line } } });
  const children = [new Paragraph({ text: plan.title, heading: HeadingLevel.TITLE })];
  for (const section of plan.sections) {
    children.push(new Paragraph({ text: section.heading, heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][(section.level || 1) - 1], keepNext: true, pageBreakBefore: section.pageBreakBefore }));
    for (const paragraph of section.paragraphs) children.push(new Paragraph({ children: [new TextRun(paragraph)], spacing: { after, line } }));
    for (const bullet of section.bullets || []) children.push(new Paragraph({ text: bullet, bullet: { level: 0 }, spacing: { after, line } }));
    if (section.table) {
      const rows = [section.table.headers, ...section.table.rows];
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map((row, index) => new TableRow({
        tableHeader: index === 0, cantSplit: true,
        children: row.map(value => new TableCell({
          shading: index === 0 ? { type: ShadingType.CLEAR, fill: (design.tableHeaderColor || '#E8EEF3').slice(1) } : undefined,
          children: [new Paragraph({ children: [new TextRun({ text: String(value ?? ''), bold: index === 0 })] })]
        }))
      })) }));
    }
  }
  const mmToTwips = value => Math.round(value * 1440 / 25.4);
  const dimensions = design.page?.size === 'LETTER' ? [215.9, 279.4] : [210, 297];
  const margins = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(k => [k, mmToTwips(design.page?.marginMm?.[k] ?? 25.4)]));
  const document = new Document({
    creator: 'Office Maker', lastModifiedBy: 'Office Maker', title: plan.title,
    styles: { default: {
      document: { run: { font, size: bodyPt * 2 }, paragraph: { spacing: { after, line } } },
      title: headingStyle(design.titlePt || 24),
      heading1: headingStyle(design.headingPt || 16),
      heading2: headingStyle(Math.max(bodyPt + 1, (design.headingPt || 16) - 2)),
      heading3: headingStyle(Math.max(bodyPt, (design.headingPt || 16) - 4))
    } },
    sections: [{ properties: { page: { size: { width: mmToTwips(dimensions[0]), height: mmToTwips(dimensions[1]), orientation: design.page?.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: margins } }, children }]
  });
  const bytes = await Packer.toBuffer(document);
  const report = await inspectDocx(bytes);
  report.warnings.push('Font availability and substitution were not checked');
  report.template = template ? { id: template.id, version: template.version } : { id: 'builtin-neutral', version: '1.0.0' };
  return { bytes, report };
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs();
    if (args.help) console.log('Usage: npm run word -- --input plan.json --output result.docx');
    else {
      const result = await generateDocument(await readJson(args.input));
      if (result.report.status === 'FAIL') throw new Error(result.report.errors.join('; '));
      const output = await writeArtifact(args.output, result.bytes, '.docx');
      console.log(JSON.stringify({ output, ...result.report }, null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
