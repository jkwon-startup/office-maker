import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const dependencies = ['pptxgenjs', 'exceljs', 'docx', 'jszip'];

export function loadDependency(name) {
  if (!dependencies.includes(name)) throw new Error('Unknown Office Maker dependency');
  try {
    return require(name);
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      throw new Error('Missing dependency: ' + name + '. Run npm ci in the package root.');
    }
    throw error;
  }
}

export function available(name) {
  try { loadDependency(name); return true; } catch { return false; }
}

export function doctor() {
  const major = Number(process.versions.node.split('.')[0]);
  const packages = Object.fromEntries(dependencies.map(name => [name, available(name)]));
  return {
    status: major >= 20 && Object.values(packages).every(Boolean) ? 'PASS' : 'WARN',
    nodeSupported: major >= 20,
    packages,
    capabilities: {
      planning: true,
      pptx: packages.pptxgenjs && packages.jszip,
      xlsx: packages.exceljs,
      docx: packages.docx && packages.jszip,
      visualReview: 'requires an available external renderer',
      originalPptTemplateReuse: false
    }
  };
}

export async function resolveTemplate(kind, selection) {
  if (!['ppt', 'excel', 'word'].includes(kind)) throw new Error('Unknown template kind');
  if (!selection || selection === 'recommended') return null;
  const skill = { ppt: 'ppt-maker', excel: 'excel-maker', word: 'word-maker' }[kind];
  const privateLibrary = typeof selection === 'object' ? selection.library : undefined;
  if (privateLibrary && !path.isAbsolute(privateLibrary)) throw new Error('A private library must use an explicit absolute path');
  const library = privateLibrary || new URL('../../skills/' + skill + '/assets/templates/index.json', import.meta.url);
  const index = JSON.parse(await readFile(library, 'utf8'));
  if (index.schemaVersion !== '1.0' || !Array.isArray(index.templates)) throw new Error('Invalid template registry');
  const requested = typeof selection === 'string' ? selection : selection.id;
  if (typeof requested !== 'string' || !requested.trim()) throw new Error('Template selection requires an ID or name');
  const prefix = { ppt: 'T', excel: 'E', word: 'W' }[kind];
  const normalized = requested.trim().toLowerCase();
  const numeric = /^\d+$/.test(normalized) ? Number(normalized) : null;
  let candidates = index.templates.filter(t =>
    t.status !== 'retired' && (t.id?.toLowerCase() === normalized ||
      (numeric !== null && t.id?.startsWith(prefix) && Number(t.id.slice(1)) === numeric) ||
      t.name?.toLowerCase() === normalized || (t.aliases || []).some(a => a.toLowerCase() === normalized)));
  if (typeof selection === 'object' && selection.version) candidates = candidates.filter(t => t.version === selection.version);
  if (!candidates.length) throw new Error('Template not registered: ' + requested);
  if (candidates.some(t => !new RegExp('^' + prefix + '[0-9]{3,6}$').test(t.id) || !/^\d+\.\d+\.\d+$/.test(t.version))) throw new Error('Invalid template ID or version');
  const identities = candidates.map(t => t.id + '@' + t.version);
  if (new Set(identities).size !== identities.length) throw new Error('Duplicate template version');
  if (new Set(candidates.map(t => t.id)).size > 1) throw new Error('Ambiguous template name; select a fixed ID');
  const ready = candidates.filter(t => t.status === 'ready' && ['privacy', 'visual', 'compatibility'].every(k => t.checks?.[k] === 'passed'));
  if (!ready.length) throw new Error('Template checks are pending; no ready version can be selected');
  if (ready.some(t => !t.modes?.includes('design_system') || !t.design)) throw new Error('Template has no supported design-system profile');
  const version = t => t.version.split('.').map(Number);
  ready.sort((a, b) => { const av = version(a), bv = version(b); return bv[0] - av[0] || bv[1] - av[1] || bv[2] - av[2]; });
  return ready[0];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(doctor(), null, 2));
}
