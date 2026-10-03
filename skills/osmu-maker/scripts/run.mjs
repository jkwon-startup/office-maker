import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { packageRoot, isMain, parseArgs, readJson, writeArtifact, supportedFormats, assertOutputPath, assertResolvedOutput } from '../../../common/runtime/paths.mjs';
import { generatePresentation } from '../../ppt-maker/scripts/generate.mjs';
import { generateWorkbook } from '../../excel-maker/scripts/generate.mjs';
import { generateDocument } from '../../word-maker/scripts/generate.mjs';
import { validateSlides } from '../../ppt-maker/scripts/validate.mjs';
import { validateWorkbook } from '../../excel-maker/scripts/validate.mjs';
import { validateDocument } from '../../word-maker/scripts/validate.mjs';

export function planOutputs(content) {
  if (!content || typeof content.topic !== 'string' || !content.topic.trim()) throw new Error('A topic is required');
  if (!Array.isArray(content.keyPoints) || !content.keyPoints.length || content.keyPoints.some(p => typeof p !== 'string' || !p.trim() || p.length > 60)) throw new Error('Key points must be short strings');
  if (typeof content.summary !== 'string' || !content.summary.trim()) throw new Error('A summary is required');
  const sources = content.sources || [];
  if (!Array.isArray(sources) || sources.some(s => typeof s?.id !== 'string' || !s.id || typeof s.title !== 'string' || !s.title) || new Set(sources.map(s => s.id)).size !== sources.length) throw new Error('Invalid source records');
  if (content.nextAction !== undefined && typeof content.nextAction !== 'string') throw new Error('Invalid next action');
  const references = sources.map(s => [s.id, s.title, s.url].filter(Boolean).join(' | '));
  const bullets = content.keyPoints.map(text => ({ text }));
  const slides = content.slides || {
    title: content.topic, sources, notes: true,
    slides: [
      { id: 'title', layout: 'title', title: content.topic, subtitle: content.summary, notes: content.summary + (references.length ? '\n\nSource material\n' + references.join('\n') : '') },
      ...content.keyPoints.map((text, index) => ({ id: 'point-' + (index + 1), layout: 'body', title: text, bullets: [bullets[index]], notes: text })),
      { id: 'closing', layout: 'closing', title: 'Next action', actionRequest: content.nextAction || 'Review the proposed next steps.', notes: content.nextAction || 'Review the proposed next steps.' }
    ]
  };
  const workbook = content.workbook || {
    title: content.topic,
    sheets: [{ name: 'Action plan', columns: [{ key: 'item', header: 'Item' }, { key: 'owner', header: 'Owner' }, { key: 'status', header: 'Status' }],
      rows: content.keyPoints.map(text => ({ item: text, owner: null, status: null })) }]
  };
  const document = content.document || {
    title: content.topic, sections: [{ heading: 'Overview', paragraphs: [content.summary] }, { heading: 'Key points', paragraphs: [...content.keyPoints] }, { heading: 'Next action', paragraphs: [content.nextAction || 'Review the proposed next steps.'] }]
  };
  if (!content.workbook && sources.length) workbook.sheets.push({ name: 'Sources', columns: [{ key: 'id', header: 'ID' }, { key: 'title', header: 'Title' }, { key: 'url', header: 'URL' }], rows: sources.map(s => ({ id: s.id, title: s.title, url: s.url || null })) });
  if (!content.document && sources.length) document.sections.push({ heading: 'Source material', paragraphs: references });
  // Explicit plans keep their own structure while sharing the canonical sources.
  if (content.slides) {
    if (JSON.stringify(content.slides.sources || []) !== JSON.stringify(sources)) throw new Error('PPT sources differ from canonical sources');
  }
  return { ppt: slides, excel: workbook, word: document };
}

export async function runPipeline(content, options = {}) {
  const plans = planOutputs(content);
  const formats = options.formats || supportedFormats;
  if (!Array.isArray(formats) || !formats.length || new Set(formats).size !== formats.length || formats.some(f => !supportedFormats.includes(f))) throw new Error('Invalid pipeline formats');
  if (options.dryRun) {
    const validators = { ppt: validateSlides, excel: validateWorkbook, word: validateDocument };
    for (const format of formats) {
      const report = validators[format](plans[format]);
      if (report.status === 'FAIL') throw new Error(format + ': ' + report.errors.join('; '));
    }
    return { status: 'PLANNED', formats, plans };
  }
  if (!options.output || !options.runDir) throw new Error('Explicit output and checkpoint directories are required');
  if (path.resolve(options.output) === path.resolve(options.runDir)) throw new Error('Output and checkpoint directories must differ');
  assertOutputPath(path.join(options.runDir, 'checkpoint.json'), '.json');
  const mapping = JSON.parse(await readFile(path.join(packageRoot, 'pipelines/osmu/output-map.json'), 'utf8'));
  const canonicalHash = createHash('sha256').update(JSON.stringify({ content, formats })).digest('hex');
  const checkpointFile = path.join(options.runDir, 'checkpoint.json');
  let previous = {};
  try {
    const stored = JSON.parse(await readFile(checkpointFile, 'utf8'));
    if (stored.hash !== canonicalHash) throw new Error('Checkpoint content differs; use a new run directory');
    previous = stored.results || {};
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const generators = options.generators || { ppt: generatePresentation, excel: generateWorkbook, word: generateDocument };
  const results = {};
  for (const format of formats) {
    const output = await assertResolvedOutput(path.join(options.output, format + mapping.formats[format].extension), mapping.formats[format].extension);
    if (previous[format]?.status === 'CREATED' && previous[format].output === path.resolve(output)) {
      try {
        const s = await lstat(output);
        if (s.isFile() && !s.isSymbolicLink() && previous[format].sha256 === createHash('sha256').update(await readFile(output)).digest('hex')) {
          results[format] = previous[format]; continue;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    try {
      const { bytes, report } = await generators[format](plans[format]);
      if (!report || report.status === 'FAIL') throw new Error('Artifact validation failed');
      const saved = await writeArtifact(output, bytes, mapping.formats[format].extension);
      results[format] = { status: 'CREATED', output: saved, sha256: createHash('sha256').update(bytes).digest('hex'), report };
    } catch (error) {
      // Keep failure details actionable without persisting source text or dependency paths.
      const reason = error.message.startsWith('Missing dependency:') ? error.message
        : error.code === 'EEXIST' ? 'Output exists; choose a new output directory.'
        : error.code ? 'Generation or output check failed (' + error.code + ').'
        : 'Generation or input validation failed; review this format plan and selected template.';
      results[format] = { status: 'FAILED', error: reason };
    }
    // Retain unvisited results so a retry never drops later successful artifacts.
    // A checkpoint is replaced intentionally; artifact outputs are never overwritten.
    const tmp = checkpointFile + '.' + randomUUID() + '.tmp';
    await writeArtifact(tmp, Buffer.from(JSON.stringify({ hash: canonicalHash, results: { ...previous, ...results } }, null, 2)), '.tmp');
    const { rename } = await import('node:fs/promises');
    await rename(tmp, checkpointFile);
  }
  const completed = Object.values(results).filter(r => r.status === 'CREATED').length;
  return { status: completed === formats.length ? 'COMPLETE' : completed ? 'PARTIAL' : 'FAILED', results };
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs();
    if (args.help) console.log('Usage: npm run osmu -- --input content.json --output outputs --run-dir work/run-001 [--dry-run]');
    else {
      const report = await runPipeline(await readJson(args.input), { output: args.output, runDir: args['run-dir'], dryRun: args['dry-run'] });
      console.log(JSON.stringify(report, null, 2));
      if (['PARTIAL', 'FAILED'].includes(report.status)) process.exitCode = 1;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
