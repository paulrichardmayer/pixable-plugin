// Bundle the sibling Pixable web app into dist/ui.html for the Figma plugin.
//
//   node build.mjs [path-to-pixable]     (default: ../Pixable)
//
// What it does, in order:
//   1. strips the CSP <meta> (Figma applies its own iframe CSP)
//   2. inlines style.css as a <style> block
//   3. lifts every <script> (external + inline) out of the document, in order,
//      and appends src/ui-overrides.js as the last one
//   4. injects src/ui-shim.js, which installs the storage/download shims and
//      then executes those sources once storage has hydrated
// No npm dependencies — Node built-ins only.

import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter(a => a !== '--check');
const CHECK_ONLY = process.argv.includes('--check');
const pixable = resolve(here, args[0] || '../Pixable');
const OUT = join(here, 'dist', 'ui.html');

// Figma loads dist/ui.html straight off disk with no build step, so a bundle
// built before a Pixable change silently ships stale app code. That already
// caused one phantom bug report (a focus fix that existed upstream but not in
// the bundle), hence `node build.mjs --check` before importing.
const SOURCE_FILES = ['index.html', 'style.css', 'colorways.js', 'sprites.js', 'app.js', 'freehand.js', 'ai.js']
  .map(f => join(pixable, f))
  .concat([join(here, 'src', 'ui-shim.js'), join(here, 'src', 'ui-overrides.js')]);

if (CHECK_ONLY) {
  if (!existsSync(OUT)) {
    console.error('STALE: dist/ui.html does not exist — run `node build.mjs`');
    process.exit(1);
  }
  const built = statSync(OUT).mtimeMs;
  const newer = SOURCE_FILES.filter(f => existsSync(f) && statSync(f).mtimeMs > built);
  if (newer.length) {
    console.error(`STALE: ${newer.length} source file(s) changed since the last build:`);
    for (const f of newer) console.error('  ' + f);
    console.error('Run `node build.mjs`, then re-run the plugin in Figma.');
    process.exit(1);
  }
  console.log('dist/ui.html is up to date with all sources.');
  process.exit(0);
}

// Which Pixable revision is going into this bundle — printed and stamped, so a
// mismatch between plugin behaviour and the web app is traceable.
let stamp = 'unknown';
try {
  const rev = execFileSync('git', ['-C', pixable, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', pixable, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  stamp = rev + (dirty ? '-dirty' : '');
} catch { /* not a git checkout; the stamp is informational only */ }

let html = readFileSync(join(pixable, 'index.html'), 'utf8');

// 1. Drop the CSP meta (multi-line tag).
html = html.replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>\s*/i, '');

// 2. Inline the stylesheet.
const css = readFileSync(join(pixable, 'style.css'), 'utf8');
html = html.replace(
  /<link rel="stylesheet" href="style\.css"\s*\/?>/i,
  () => `<style>\n${css}\n</style>`
);

// 3. Collect scripts in document order, removing them from the page.
const sources = []; // { name, code }
html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_, attrs, inline) => {
  const src = attrs.match(/src="([^"]+)"/);
  if (src) {
    sources.push({ name: src[1], code: readFileSync(join(pixable, src[1]), 'utf8') });
  } else {
    sources.push({ name: `inline-${sources.length}`, code: inline });
  }
  return '';
});
if (sources.length < 5) {
  throw new Error(`expected at least 5 scripts in index.html, found ${sources.length}`);
}

// Plugin-only UI adjustments run last, after the app has built its DOM.
sources.push({
  name: 'ui-overrides.js',
  code: readFileSync(join(here, 'src', 'ui-overrides.js'), 'utf8'),
});

// 4. Inject the shim. Sources travel base64-encoded so nothing in the app
// (regex literals, "</script>", unicode) can break the HTML parse.
const payload = JSON.stringify(
  sources.map(s => ({ name: s.name, b64: Buffer.from(s.code, 'utf8').toString('base64') }))
);
const shimSrc = readFileSync(join(here, 'src', 'ui-shim.js'), 'utf8');
// Exactly one placeholder, or the substitution silently lands in the wrong
// place (a second mention in a comment would eat the replacement).
const hits = (shimSrc.match(/__SOURCES__/g) || []).length;
if (hits !== 1) throw new Error(`ui-shim.js must contain __SOURCES__ exactly once, found ${hits}`);
const shim = shimSrc.replace('__SOURCES__', () => payload);

html = html.replace(/<\/body>/i, `<script>\n${shim}\n</script>\n</body>`);
html = `<!-- built from Pixable @ ${stamp} -->\n` + html;

mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(OUT, html);
console.log(
  `dist/ui.html written from Pixable @ ${stamp} ` +
  `(${(html.length / 1024).toFixed(0)} KB, ${sources.length} scripts: ${sources.map(s => s.name).join(', ')})`
);
if (stamp.endsWith('-dirty')) {
  console.log('note: the Pixable working tree has uncommitted changes.');
}
