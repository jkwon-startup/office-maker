import { loadDependency, resolveTemplate } from '../../../common/runtime/doctor.mjs';
import { isMain, parseArgs, readJson, writeArtifact } from '../../../common/runtime/paths.mjs';
import { validateWorkbook, inspectXlsx } from './validate.mjs';

export async function generateWorkbook(plan) {
  const check = validateWorkbook(plan);
  if (check.status === 'FAIL') throw new Error(check.errors.join('; '));
  if (plan.mode && plan.mode !== 'design_system') throw new Error('Original XLSX structure reuse is not implemented.');
  const template = await resolveTemplate('excel', plan.template);
  const ExcelJS = loadDependency('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Office Maker';
  workbook.lastModifiedBy = 'Office Maker';
  workbook.title = plan.title;
  workbook.calcProperties.fullCalcOnLoad = true;
  const style = template?.design || {};
  for (const data of plan.sheets) {
    const sheet = workbook.addWorksheet(data.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = data.columns.map(column => ({ header: column.header, key: column.key, width: column.width || style.columnWidth || 24 }));
    sheet.addRows(data.rows);
    const header = sheet.getRow(1);
    header.font = { name: style.font || 'Arial', bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: (style.headerColor || '#18324A').replace('#', '') } };
    for (let row = 2; row <= sheet.rowCount; row++) {
      sheet.getRow(row).font = { name: style.font || 'Arial', size: style.bodyPt || 11 };
      sheet.getRow(row).alignment = { vertical: 'top', wrapText: true };
    }
    for (const column of data.columns) if (column.numberFormat) sheet.getColumn(column.key).numFmt = column.numberFormat;
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: data.columns.length } };
    sheet.pageSetup = { orientation: style.orientation || 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const report = await inspectXlsx(bytes, plan);
  report.template = template ? { id: template.id, version: template.version } : { id: 'builtin-neutral', version: '1.0.0' };
  return { bytes, report };
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs();
    if (args.help) console.log('Usage: npm run excel -- --input plan.json --output result.xlsx');
    else {
      const result = await generateWorkbook(await readJson(args.input));
      if (result.report.status === 'FAIL') throw new Error(result.report.errors.join('; '));
      const output = await writeArtifact(args.output, result.bytes, '.xlsx');
      console.log(JSON.stringify({ output, ...result.report }, null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
