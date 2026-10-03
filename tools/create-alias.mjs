import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { packageRoot, isMain, parseArgs, assertResolvedOutput, writeArtifact } from '../common/runtime/paths.mjs';

const skills = ['ppt-maker', 'excel-maker', 'word-maker', 'osmu-maker'];

export async function createAlias({ name, target, dest, dryRun = false }) {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length > 64 || skills.includes(name)) {
    throw new Error('Choose a unique lowercase skill name with letters, numbers and hyphens');
  }
  if (!skills.includes(target)) throw new Error('Select ppt-maker, excel-maker, word-maker or osmu-maker with --input');
  if (!dest || !path.isAbsolute(dest)) throw new Error('--dest must be an explicit absolute personal skill directory');
  const directory = path.join(dest, name);
  const resolved = await assertResolvedOutput(path.join(directory, 'SKILL.md'), '.md');
  const relative = path.relative(packageRoot, resolved);
  if (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) {
    throw new Error('Keep personal aliases outside the distributable package');
  }
  try {
    await lstat(directory);
    throw new Error('Alias directory already exists; choose another name');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const base = path.join(packageRoot, 'skills', target, 'SKILL.md');
  const outputs = [path.join(directory, 'SKILL.md'), path.join(directory, 'agents/openai.yaml')];
  if (dryRun) return { status: 'PLANNED', name, target, files: outputs };
  const body = `---\nname: ${name}\ndescription: "Explicit personal alias for ${target}. Use only when the user invokes this alias."\n---\n\nRead the installed base skill at the following local path and follow its instructions.\n\n${JSON.stringify(base)}\n\nIf the base file is missing, explain that the package moved and recreate this alias. Do not replace the task with another workflow.\n`;
  const ui = `interface:\n  display_name: ${JSON.stringify(name)}\n  short_description: "Personal invocation alias"\n  default_prompt: ${JSON.stringify('Use $' + name + ' to run ' + target + '.')}\npolicy:\n  allow_implicit_invocation: false\n`;
  await writeArtifact(outputs[0], body, '.md');
  await writeArtifact(outputs[1], ui, '.yaml');
  return { status: 'CREATED', name, target, files: outputs };
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs();
    if (args.help) console.log('Usage: node tools/create-alias.mjs --name my-ppt --input ppt-maker --dest <absolute-personal-skill-directory> [--dry-run]');
    else console.log(JSON.stringify(await createAlias({ name: args.name, target: args.input, dest: args.dest, dryRun: args['dry-run'] }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
