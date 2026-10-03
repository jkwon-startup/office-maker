import { loadDependency } from '../../../common/runtime/doctor.mjs';
import { newReport } from '../../../common/runtime/paths.mjs';

export function validateWorkbook(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return newReport('excel', ['Invalid workbook plan']);
  if (typeof plan.title !== 'string' || !plan.title.trim()) errors.push('Workbook title is required');
  if (!Array.isArray(plan.sheets) || !plan.sheets.length) errors.push('At least one sheet is required');
  const names = new Set();
  for (const sheet of Array.isArray(plan.sheets) ? plan.sheets : []) {
    if (!sheet || typeof sheet !== 'object') { errors.push('Invalid sheet'); continue; }
    if (typeof sheet.name !== 'string' || !sheet.name || sheet.name.length > 31 || /[\\/?*\[\]:]/.test(sheet.name) || names.has(sheet.name.toLowerCase())) errors.push('Invalid or duplicate sheet name');
    if (typeof sheet.name === 'string') names.add(sheet.name.toLowerCase());
    if (!Array.isArray(sheet.columns) || !sheet.columns.length) errors.push('Columns are required');
    const keys = new Set();
    for (const column of Array.isArray(sheet.columns) ? sheet.columns : []) {
      if (typeof column?.key !== 'string' || !column.key || typeof column.header !== 'string' || !column.header || keys.has(column.key)) errors.push('Invalid or duplicate column key');
      if (column?.width !== undefined && (!Number.isFinite(column.width) || column.width <= 0 || column.width > 255)) errors.push('Invalid column width');
      if (column?.numberFormat !== undefined && typeof column.numberFormat !== 'string') errors.push('Invalid number format');
      keys.add(column?.key);
    }
    if (!Array.isArray(sheet.rows)) errors.push('Rows must be an array');
    for (const row of Array.isArray(sheet.rows) ? sheet.rows : []) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) { errors.push('Rows must be objects'); continue; }
      for (const [key, value] of Object.entries(row)) {
        if (!keys.has(key)) errors.push('Unknown column key: ' + key);
        if (value !== null && typeof value === 'object') {
          if (typeof value.formula !== 'string' || !value.formula.trim() || value.formula.startsWith('=')) errors.push('Formula must be explicit without leading =');
          if (Object.keys(value).some(k => !['formula', 'result'].includes(k))) errors.push('Unsupported formula field');
          if (value.result !== undefined && value.result !== null && (!['string', 'number', 'boolean'].includes(typeof value.result) || (typeof value.result === 'number' && !Number.isFinite(value.result)))) errors.push('Invalid formula cache');
        } else if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) errors.push('Unsupported cell value');
        if (typeof value === 'number' && !Number.isFinite(value)) errors.push('Nonfinite cell value');
      }
    }
  }
  return newReport('excel', errors);
}

export async function inspectXlsx(bytes, plan) {
  const ExcelJS = loadDependency('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const errors = [];
  if (workbook.worksheets.length !== plan.sheets.length) errors.push('Actual sheet count mismatch');
  for (const sheet of plan.sheets) if (!workbook.getWorksheet(sheet.name)) errors.push('Missing expected sheet');
  return { ...newReport('excel', errors, ['Formula results require recalculation in a spreadsheet application', 'Visual review not performed']), createdSheets: workbook.worksheets.length };
}
