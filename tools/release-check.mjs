import path from 'node:path';
import { readdir, lstat, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { packageRoot, isMain } from '../common/runtime/paths.mjs';

const rootFiles = ['.gitignore', 'README.md', 'LICENSE', 'plugin.json', 'package.json', 'package-lock.json', '.agents/plugins/marketplace.json'];
const folders = ['skills', 'common', 'pipelines', 'tools', 'examples', 'tests', 'docs', '.github'];
const privatePaths = /^(?:node_modules|\.cache|\.git|work|outputs|inputs|settings|personal-templates|\.codex)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|AGENTS(?:\.override)?\.md|\.DS_Store|Thumbs\.db)$/;
const personalPath = /\/(?:Users|home)\/[a-zA-Z0-9._-]+\/|[A-Z]:\\Users\\[^\\\s"'<>]+\\/i;
const contactMarker = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const secretMarker = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bsk-[A-Za-z0-9_-]{30,}\b/;
const reviewedPreviews = new Set(['ppt', 'excel', 'word'].map(kind => 'examples/synthetic/previews/' + kind + '.png'));

export function isPlainPreviewPng(bytes) {
  if (bytes.length > 4 * 1024 * 1024 || bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  let offset = 8, header = false, data = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset + 12 + length > bytes.length || !['IHDR', 'IDAT', 'IEND'].includes(type)) return false;
    if (type === 'IHDR') {
      if (header || offset !== 8 || length !== 13) return false;
      const width = bytes.readUInt32BE(offset + 8), height = bytes.readUInt32BE(offset + 12);
      if (!width || !height || width > 10000 || height > 10000) return false;
      header = true;
    } else if (!header) return false;
    if (type === 'IDAT') data = true;
    if (type === 'IEND') return data && length === 0 && offset + 12 === bytes.length;
    offset += length + 12;
  }
  return false;
}

export async function collectReleaseFiles(root = packageRoot) {
  const files = [];
  const visit = async relative => {
    let info;
    try { info = await lstat(path.join(root, relative)); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) throw new Error('Release source cannot be a symlink: ' + relative);
    if (info.isDirectory()) {
      for (const name of (await readdir(path.join(root, relative))).sort()) await visit(relative + '/' + name);
    } else if (info.isFile()) files.push(relative);
    else throw new Error('Unsupported release source: ' + relative);
  };
  for (const file of [...rootFiles, ...folders]) await visit(file);
  return files.sort();
}

export async function auditRelease(root = packageRoot) {
  const errors = [];
  const files = await collectReleaseFiles(root);
  for (const name of rootFiles) if (!files.includes(name)) errors.push({ file: name, reason: 'Required package file is missing' });
  for (const file of files) {
    if (privatePaths.test(file) || file.startsWith('examples/') && !file.startsWith('examples/synthetic/')) {
      errors.push({ file, reason: 'Private or non-synthetic file in release' }); continue;
    }
    if (reviewedPreviews.has(file)) {
      if (!isPlainPreviewPng(await readFile(path.join(root, file)))) errors.push({ file, reason: 'Preview PNG is malformed or contains unreviewed metadata' });
      continue;
    }
    if (!['.md', '.json', '.mjs', '.yml', '.yaml'].includes(path.extname(file)) && !['LICENSE', '.gitignore'].includes(file)) {
      errors.push({ file, reason: 'Additional asset requires a separate privacy and rights review' }); continue;
    }
    const content = await readFile(path.join(root, file), 'utf8');
    // npm upstream deprecation notices can contain public maintainer contacts.
    // Ignore those notices for contact scanning, but still scan all paths and secrets.
    const contactText = file === 'package-lock.json' ? content.replace(/"deprecated":\s*"(?:\\.|[^"\\])*"/g, '') : content;
    if (personalPath.test(content) || contactMarker.test(contactText)) errors.push({ file, reason: 'Personal path or contact marker' });
    if (secretMarker.test(content)) errors.push({ file, reason: 'Secret marker' });
    if (file.endsWith('.json')) {
      try { JSON.parse(content); } catch { errors.push({ file, reason: 'Invalid JSON' }); }
    }
    if (file.endsWith('/SKILL.md') && !/^---\r?\nname: [a-z][a-z0-9-]*\r?\ndescription: .+\r?\n---/s.test(content)) errors.push({ file, reason: 'Skill name or description frontmatter is missing' });
  }
  for (const name of ['ppt-maker', 'excel-maker', 'word-maker', 'osmu-maker']) {
    if (!files.includes('skills/' + name + '/SKILL.md')) errors.push({ file: 'skills/' + name + '/SKILL.md', reason: 'Required skill is missing' });
  }
  // A previously tracked customer file is not removed by .gitignore.
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (path.resolve(top) === path.resolve(root)) {
      const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
      for (const file of tracked) if (!files.includes(file)) errors.push({ file, reason: 'Tracked file is outside the release allowlist' });
    }
  } catch { /* Extracted packages may have no Git repository. */ }
  return { status: errors.length ? 'FAIL' : 'PASS', fileCount: files.length, files, errors,
    limits: ['Marker scan requires manual content, metadata and asset-rights review; it does not identify all personal data.'] };
}

if (isMain(import.meta.url)) {
  try {
    const report = await auditRelease(); console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'PASS') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
