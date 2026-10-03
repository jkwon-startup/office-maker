import path from 'node:path';
import { createRequire } from 'node:module';
import { access, copyFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { packageRoot, isMain, assertResolvedOutput } from './paths.mjs';
import { collectReleaseFiles } from '../../tools/release-check.mjs';

const dependencies = ['pptxgenjs', 'exceljs', 'docx', 'jszip'];

export async function inspectRuntime(root) {
  const require = createRequire(path.join(root, 'package.json'));
  const missing = [];
  for (const name of dependencies) {
    try {
      // An ancestor checkout's dependencies must not hide an incomplete installation.
      // Use an absolute package path: bare-name resolution can retain an ancestor
      // result in Node's path cache even after npm installs the local dependency.
      require(path.join(root, 'node_modules', name));
    } catch { missing.push(name); }
  }
  return { nodeSupported: Number(process.versions.node.split('.')[0]) >= 20, missing };
}

async function runNpm(args, { cwd }) {
  const candidates = [];
  if (process.env.npm_execpath?.endsWith('.js')) candidates.push(process.env.npm_execpath);
  for (const folder of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(folder, 'node_modules/npm/bin/npm-cli.js'));
    try { candidates.push(await realpath(path.join(folder, 'npm'))); } catch { /* Search the next PATH entry. */ }
  }
  let cli;
  for (const candidate of candidates) {
    if (!candidate.endsWith('.js')) continue;
    try { await access(candidate); cli = candidate; break; } catch { /* Continue. */ }
  }
  if (!cli) throw Error('npm is unavailable. Install Node.js 20 or newer with npm in the execution environment.');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(Error('Dependency installation failed (npm exit ' + code + '). Check network access and write permissions.')));
  });
}

export async function ensureRuntime({ root = packageRoot, install = false, dest, probe = inspectRuntime, runner = runNpm } = {}) {
  root = path.resolve(root);
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const plugin = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  await access(path.join(root, 'package-lock.json'));
  if (manifest.name !== 'office-maker' || plugin.version !== manifest.version) throw Error('Unexpected or inconsistent Office Maker package');
  const initial = await probe(root);
  if (!initial.nodeSupported) throw Error('Node.js 20 or newer is required.');
  let copied = false;
  if (dest) {
    if (!path.isAbsolute(dest)) throw Error('Runtime destination must be an absolute path');
    if (!install) throw Error('Copying a runtime requires --install');
    dest = path.resolve(dest);
    await assertResolvedOutput(path.join(dest, 'package.json'));
    try { await stat(dest); throw Error('Runtime destination already exists; reuse it or select a new directory.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const files = await collectReleaseFiles(root);
    await mkdir(dest, { recursive: true });
    for (const file of files) {
      const target = path.join(dest, file);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(root, file), target, constants.COPYFILE_EXCL);
    }
    root = dest;
    copied = true;
  }
  let state = copied ? await probe(root) : initial;
  let installed = false;
  if (state.missing.length && install) {
    await runner(['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(root, '.cache/npm')], { cwd: root });
    installed = true;
    state = await probe(root);
    if (state.missing.length) throw Error('Dependencies are still unavailable: ' + state.missing.join(', '));
  }
  return { status: state.missing.length ? 'NEEDS_SETUP' : 'READY', root, installed, copied, missing: state.missing };
}

if (isMain(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--install') options.install = true;
      else if (args[i] === '--check') options.check = true;
      else if (args[i] === '--dest' && args[i + 1] && !args[i + 1].startsWith('--')) options.dest = args[++i];
      else throw Error('Usage: node common/runtime/setup.mjs [--check | --install] [--dest <absolute-runtime-directory>]');
    }
    if (options.check && options.install) throw Error('Choose --check or --install');
    const result = await ensureRuntime(options);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'READY') process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
