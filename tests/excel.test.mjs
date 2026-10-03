import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkbook } from '../skills/excel-maker/scripts/validate.mjs';
import { generateWorkbook } from '../skills/excel-maker/scripts/generate.mjs';
import { available, loadDependency } from '../common/runtime/doctor.mjs';

export const workbook = {
  title: 'Synthetic workbook',
  sheets: [{ name: 'Tasks', columns: [{ key: 'task', header: 'Task' }, { key: 'count', header: 'Count' }],
    rows: [{ task: 'Synthetic task', count: 2 }, { task: 'Formula example', count: { formula: 'B2*2', result: 4 } }] }]
};
test('workbook row shape and explicit formulas pass', () => assert.equal(validateWorkbook(workbook).status, 'PASS'));
test('unknown columns are rejected', () => {
  const p = structuredClone(workbook); p.sheets[0].rows[0].unknown = 1;
  assert.equal(validateWorkbook(p).status, 'FAIL');
});
test('duplicate sheet names are rejected', () => {
  const p = structuredClone(workbook); p.sheets.push({ ...p.sheets[0], name: 'tasks' });
  assert.equal(validateWorkbook(p).status, 'FAIL');
});

test('formula cache objects and invalid widths are rejected', () => {
  const p = structuredClone(workbook);
  p.sheets[0].columns[0].width = -1;
  p.sheets[0].rows[1].count.result = { value: 4 };
  assert.equal(validateWorkbook(p).status, 'FAIL');
});

test('generated XLSX preserves formulas and string cells', { skip: !process.env.CI && !available('exceljs') }, async () => {
  const p = structuredClone(workbook);
  p.sheets[0].rows[0].task = '=keep as text';
  const { bytes, report } = await generateWorkbook(p);
  assert.equal(report.createdSheets, 1);
  assert.equal(report.status, 'WARN');
  const ExcelJS = loadDependency('exceljs');
  const actual = new ExcelJS.Workbook();
  await actual.xlsx.load(bytes);
  const sheet = actual.getWorksheet('Tasks');
  assert.equal(sheet.getCell('A2').value, '=keep as text');
  assert.equal(sheet.getCell('B3').formula, 'B2*2');
  assert.equal(sheet.getCell('B3').result, 4);
});
