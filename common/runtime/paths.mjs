import { readFile, mkdir, writeFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const protectedRoots = ['skills', 'common', 'pipelines', 'tools', 'tests', 'examples', 'docs', '.github', '.agents', '.codex', '.git'];
export const supportedFormats = ['ppt', 'excel', 'word'];

export function parseArgs(args = process.argv.slice(2)) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--input', '--output', '--run-dir', '--name', '--dest', '--help', '--dry-run'].includes(key)) {
      throw new Error('Unknown argument: ' + key);
    }
    if (['--help', '--dry-run'].includes(key)) result[key.slice(2)] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing argument value: ' + key);
      result[key.slice(2)] = value;
    }
  }
  return result;
}

export function isMain(url) {
  return Boolean(process.argv[1] && url === pathToFileURL(process.argv[1]).href);
}

export async function readJson(file) {
  if (!file) throw new Error('--input is required');
  return JSON.parse(await readFile(path.resolve(file), 'utf8'));
}

function inside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

export function assertOutputPath(file, extension) {
  if (!file) throw new Error('An explicit output path is required');
  const output = path.resolve(file);
  if (extension && path.extname(output).toLowerCase() !== extension) throw new Error('Unexpected output extension');
  const rootFiles = ['README.md', 'LICENSE', 'plugin.json', 'package.json', 'package-lock.json', '.gitignore', 'AGENTS.md'];
  if (output === packageRoot || rootFiles.some(name => output === path.join(packageRoot, name)) || protectedRoots.some(name => inside(output, path.join(packageRoot, name)))) {
    throw new Error('Customer output must not be written into distributable source folders');
  }
  return output;
}

export async function assertResolvedOutput(file, extension) {
  const output = assertOutputPath(file, extension);
  // Resolve the nearest existing parent to reject symlinks into source folders.
  let parent = path.dirname(output);
  const suffix = [];
  while (true) {
    try {
      await lstat(parent);
      const resolved = path.join(await realpath(parent), ...suffix.reverse(), path.basename(output));
      assertOutputPath(resolved, extension);
      return resolved;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      suffix.push(path.basename(parent));
      const next = path.dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
}

export async function writeArtifact(file, bytes, extension) {
  const output = await assertResolvedOutput(file, extension);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, bytes, { flag: 'wx' });
  return output;
}

export function newReport(format, errors = [], warnings = []) {
  return {
    format,
    status: errors.length ? 'FAIL' : warnings.length ? 'WARN' : 'PASS',
    errors, warnings,
    manualChecks: ['Visual rendering', 'Fonts and line wrapping', 'Application compatibility']
  };
}
