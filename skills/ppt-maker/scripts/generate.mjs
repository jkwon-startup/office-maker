import { loadDependency, resolveTemplate } from '../../../common/runtime/doctor.mjs';
import { isMain, parseArgs, readJson, writeArtifact } from '../../../common/runtime/paths.mjs';
import { validateSlides, inspectPptx } from './validate.mjs';

export async function generatePresentation(plan) {
  const preflight = validateSlides(plan);
  if (preflight.status === 'FAIL') throw new Error(preflight.errors.join('; '));
  if (plan.mode && plan.mode !== 'design_system') throw new Error('Original PPTX structure reuse is not implemented; choose design_system explicitly.');
  const template = await resolveTemplate('ppt', plan.template);
  const PptxGenJS = loadDependency('pptxgenjs');
  const ppt = new PptxGenJS();
  const width = template?.aspectRatio === '4:3' ? 10 : 13.333333;
  const height = 7.5;
  ppt.defineLayout({ name: 'OFFICE_MAKER', width, height });
  ppt.layout = 'OFFICE_MAKER';
  ppt.title = plan.title;
  ppt.subject = 'Generated presentation';
  ppt.author = 'Office Maker';
  ppt.company = '';
  ppt.lang = plan.language || 'en-US';
  const design = template?.design;
  const color = key => (design?.colors?.[key] || ({ background: '#FFFFFF', heading: '#18324A', text: '#222222', accent: '#20746A', muted: '#666666' }[key])).replace('#', '');
  const headingFont = design?.fonts?.heading || 'Arial';
  const bodyFont = design?.fonts?.body || 'Arial';
  const marginX = (design?.spacing?.marginX ?? 0.05) * width;
  const marginY = (design?.spacing?.marginY ?? 0.05) * height;
  const bodySize = design?.typography?.bodyPt || 18;
  const warnings = ['Font availability and substitution were not checked'];
  if (design?.shapeStyle && design.shapeStyle !== 'square') warnings.push('Extended shape style is not applied by the basic renderer');
  const sourceMap = new Map((plan.sources || []).map(source => [source.id, source]));
  for (const [number, data] of plan.slides.entries()) {
    const slide = ppt.addSlide();
    slide.background = { color: color('background') };
    const selected = template?.layouts.find(l => data.layoutId ? l.id === data.layoutId : l.kind === data.layout);
    if (data.layoutId && !selected) throw new Error('Unknown registered layout ID');
    if (selected && selected.kind !== data.layout) throw new Error('Registered layout kind mismatch');
    if (template && !selected) warnings.push('Derived layout: ' + data.layout);
    const region = (role, fallback) => {
      const r = selected?.regions.find(r => r.role === role);
      if (!r) return fallback;
      if (r.x + r.w > 1 || r.y + r.h > 1) throw new Error('Template region is outside the slide');
      return { x: r.x * width, y: r.y * height, w: r.w * width, h: r.h * height };
    };
    const titleBox = region('title', { x: marginX, y: marginY, w: width - marginX * 2, h: 0.8 });
    const bodyBox = region('body', { x: marginX, y: 1.7, w: width - marginX * 2, h: 4.6 });
    const write = (text, box, options = {}) => slide.addText(String(text ?? ''), {
      ...box, fontFace: bodyFont, fontSize: bodySize, color: color('text'), margin: 0.04, breakLine: false, ...options
    });
    const bulletText = items => (items || []).map(b => (b.label ? b.label + ': ' : '') + b.text).join('\n\n');
    write(data.title, titleBox, { fontFace: headingFont, fontSize: design?.typography?.titlePt || 30, bold: true, color: color('heading') });
    if (data.subtitle) write(data.subtitle, region('subtitle', { x: marginX, y: 1.15, w: width - marginX * 2, h: 0.4 }), { fontSize: 16, color: color('muted') });
    if (data.layout === 'comparison') {
      const gap = 0.3;
      const w = (bodyBox.w - gap) / 2;
      for (const [index, half] of [data.left, data.right].entries()) {
        const box = { x: bodyBox.x + index * (w + gap), y: bodyBox.y, w, h: bodyBox.h };
        write(half.heading, { ...box, h: 0.5 }, { bold: true, color: color('accent') });
        write(bulletText(half.bullets), { ...box, y: box.y + 0.65, h: box.h - 0.65 });
      }
    } else if (data.layout === 'roadmap' || data.layout === 'kpi') {
      const items = data.layout === 'roadmap' ? data.stages : data.metrics;
      const gap = 0.2, w = (bodyBox.w - gap * (items.length - 1)) / items.length;
      for (const [i, item] of items.entries()) {
        const x = bodyBox.x + i * (w + gap);
        slide.addShape(ppt.ShapeType.rect, { x, y: bodyBox.y, w, h: bodyBox.h, fill: { color: color('background') }, line: { color: color('accent'), width: 1 } });
        const status = plan.language?.startsWith('ko') ? ({ fact: '확인값', target: '목표', assumption: '가정' }[item.status] || item.status) : item.status;
        const text = data.layout === 'roadmap'
          ? [item.name, item.timing, item.owner, item.deliverable].filter(Boolean).join('\n\n')
          : [item.name, item.value === undefined ? item.method : String(item.value) + (item.unit || ''), status].filter(Boolean).join('\n\n');
        write(text, { x: x + 0.1, y: bodyBox.y + 0.15, w: w - 0.2, h: bodyBox.h - 0.3 }, { fontSize: Math.min(bodySize, 18) });
      }
    } else {
      write(bulletText(data.bullets) || data.actionRequest || (data.layout === 'title' ? '' : data.subtitle) || '', bodyBox);
    }
    const footer = region('footer', { x: marginX, y: height - 0.55, w: width - marginX * 2, h: 0.25 });
    const sourceLabel = (data.sources || []).map(id => sourceMap.get(id)?.title || id).join(' · ');
    write([sourceLabel, (number + 1) + '/' + plan.slides.length].filter(Boolean).join(' | '), footer, { fontSize: 9, color: color('muted') });
    if (plan.notes !== false) {
      const detail = (data.sources || []).map(id => {
        const source = sourceMap.get(id); return [id, source?.title, source?.url].filter(Boolean).join(' | ');
      }).join('\n');
      slide.addNotes(data.notes + (detail ? '\n\nReferences\n' + detail : ''));
    }
  }
  const bytes = Buffer.from(await ppt.write({ outputType: 'nodebuffer' }));
  const report = await inspectPptx(bytes, plan);
  report.warnings.push(...warnings);
  report.template = template ? { id: template.id, version: template.version } : { id: 'builtin-neutral', version: '1.0.0' };
  report.status = report.errors.length ? 'FAIL' : report.warnings.length ? 'WARN' : 'PASS';
  return { bytes, report };
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs();
    if (args.help) console.log('Usage: npm run ppt -- --input plan.json --output result.pptx');
    else {
      const result = await generatePresentation(await readJson(args.input));
      if (result.report.status === 'FAIL') throw new Error(result.report.errors.join('; '));
      const output = await writeArtifact(args.output, result.bytes, '.pptx');
      console.log(JSON.stringify({ output, ...result.report }, null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
