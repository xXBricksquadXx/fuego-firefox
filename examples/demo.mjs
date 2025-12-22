import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';

import { request, cleanup } from '../dist/index.mjs';

const args = process.argv.slice(2);

function flag(name) {
  return args.includes(name);
}
function arg(name, fallback) {
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const TARGET = arg('--url', 'https://rosehillops.com/');
const HEADFUL = flag('--headful');
const MINIFY_JS = flag('--minify-js');
const CHUNK_JS = Number(arg('--chunk-js', '200000')); // bytes; 0 disables
const DO_CLEAN = flag('--clean');

const OUTROOT = '.demo-out';
const RUNS_DIR = join(OUTROOT, 'runs');
const targetURL = new URL(TARGET);

if (DO_CLEAN) {
  if (existsSync(OUTROOT)) rmSync(OUTROOT, { recursive: true, force: true });
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}
function writeText(file, text) {
  ensureDir(join(file, '..'));
  writeFileSync(file, text, 'utf8');
}
function writeBin(file, buf) {
  ensureDir(join(file, '..'));
  writeFileSync(file, buf);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}
function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(
    d.getDate()
  )}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}
function slug(s) {
  return s
    .replace(/[^a-z0-9-_]+/gi, '_')
    .replace(/_+/g, '_')
    .toLowerCase();
}
function sha(url) {
  return createHash('sha1').update(url).digest('hex').slice(0, 10);
}

function kindFromContentType(ct) {
  const v = (ct || '').toLowerCase();
  if (v.includes('text/css')) return 'css';
  if (v.includes('javascript') || v.includes('ecmascript')) return 'js';
  if (v.includes('application/json')) return 'json';
  if (v.includes('text/html')) return 'html';
  if (v.startsWith('image/')) return 'img';
  if (
    v.includes('font/') ||
    v.includes('woff') ||
    v.includes('ttf') ||
    v.includes('otf')
  )
    return 'font';
  return 'other';
}

function extGuess(kind, urlStr, ct) {
  const u = new URL(urlStr);
  const ext = extname(u.pathname);
  if (ext) return ext;
  if (kind === 'js') return '.js';
  if (kind === 'css') return '.css';
  if (kind === 'json') return '.json';
  if (kind === 'html') return '.html';
  if (kind === 'img') {
    const v = (ct || '').toLowerCase();
    if (v.includes('png')) return '.png';
    if (v.includes('jpeg')) return '.jpg';
    if (v.includes('webp')) return '.webp';
    if (v.includes('svg')) return '.svg';
    if (v.includes('gif')) return '.gif';
  }
  return '.bin';
}

async function maybeMinifyJs(inputText) {
  if (!MINIFY_JS) return null;
  try {
    const esbuild = await import('esbuild');
    const out = await esbuild.transform(inputText, {
      minify: true,
      loader: 'js',
      sourcemap: false,
    });
    return out.code;
  } catch {
    return null;
  }
}

function chunkAndWrite(text, caseDir, baseName, chunkBytes) {
  if (!chunkBytes || chunkBytes <= 0) return;
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= chunkBytes) return;

  const outDir = join(caseDir, 'assets', 'js-chunks', baseName);
  ensureDir(outDir);

  let off = 0;
  let i = 0;
  while (off < buf.length) {
    const end = Math.min(off + chunkBytes, buf.length);
    const part = buf.slice(off, end);
    const file = join(outDir, `${String(i).padStart(3, '0')}.js`);
    writeBin(file, part);
    off = end;
    i++;
  }
}

function makeRunDir() {
  const runId = `${nowStamp()}__${slug(targetURL.host)}`;
  const runDir = join(RUNS_DIR, runId);

  ensureDir(runDir);
  ensureDir(join(runDir, 'cases'));

  writeText(
    join(runDir, 'run.json'),
    JSON.stringify(
      {
        target: TARGET,
        headful: HEADFUL,
        minifyJs: MINIFY_JS,
        chunkJsBytes: CHUNK_JS,
        startedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  return runDir;
}

function makeCaseDir(runDir, name) {
  const dir = join(runDir, 'cases', slug(name));
  ensureDir(dir);
  ensureDir(join(dir, 'html'));
  ensureDir(join(dir, 'components'));
  ensureDir(join(dir, 'assets', 'css'));
  ensureDir(join(dir, 'assets', 'js'));
  ensureDir(join(dir, 'assets', 'js-min'));
  ensureDir(join(dir, 'assets', 'js-chunks'));
  ensureDir(join(dir, 'assets', 'img'));
  ensureDir(join(dir, 'assets', 'font'));
  ensureDir(join(dir, 'assets', 'json'));
  ensureDir(join(dir, 'assets', 'other'));
  ensureDir(join(dir, 'cdn'));
  return dir;
}

function attachCapture(page, caseDir, manifest) {
  page.on('response', async (resp) => {
    try {
      const urlStr = resp.url();
      if (!urlStr.startsWith('http')) return;

      const status = resp.status();
      const headers = resp.headers();
      const ct = headers['content-type'] || '';
      const host = new URL(urlStr).host;
      const isCDN = host !== targetURL.host;

      if (status === 304 || (status >= 300 && status < 400)) {
        manifest.responses.push({ url: urlStr, status, ct, skipped: true });
        return;
      }

      const buf = await resp.body().catch(() => null);
      if (!buf || buf.length === 0) {
        manifest.responses.push({ url: urlStr, status, ct, empty: true });
        return;
      }

      const kind = kindFromContentType(ct);
      const ext = extGuess(kind, urlStr, ct);
      const base = basename(new URL(urlStr).pathname) || 'asset';
      const fileBase = `${sha(urlStr)}__${slug(base || 'asset')}${ext}`;

      let rel;
      if (isCDN) {
        rel = join('cdn', slug(host), kind, fileBase);
      } else {
        rel = join('assets', kind, fileBase);
      }

      writeBin(join(caseDir, rel), buf);

      if (!isCDN && kind === 'js') {
        const originalText = buf.toString('utf8');

        if (MINIFY_JS) {
          const min = await maybeMinifyJs(originalText);
          if (min) {
            const minRel = join(
              'assets',
              'js-min',
              fileBase.replace(/\.js$/i, '.min.js')
            );
            writeText(join(caseDir, minRel), min);

            const baseName = fileBase.replace(/\.[^.]+$/, '');
            chunkAndWrite(min, caseDir, `${baseName}__min`, CHUNK_JS);
          }
        }

        const baseName = fileBase.replace(/\.[^.]+$/, '');
        chunkAndWrite(originalText, caseDir, `${baseName}__orig`, CHUNK_JS);
      }

      manifest.responses.push({
        url: urlStr,
        status,
        ct,
        bytes: buf.length,
        file: rel.replaceAll('\\', '/'),
      });
    } catch (e) {
      manifest.errors.push(String(e?.message || e));
    }
  });

  page.on('requestfailed', (req) => {
    manifest.failed.push({
      url: req.url(),
      type: req.resourceType(),
      method: req.method(),
      failure: req.failure()?.errorText || 'unknown',
    });
  });

  page.on('console', (msg) => {
    manifest.console.push({
      type: msg.type(),
      text: msg.text(),
    });
  });
}

async function runCase(runDir, name, opts, { capture = false } = {}) {
  const caseDir = makeCaseDir(runDir, name);

  const manifest = {
    name,
    url: opts.url,
    startedAt: new Date().toISOString(),
    capture,
    responses: [],
    failed: [],
    console: [],
    errors: [],
  };

  console.log(`\n=== ${name} ===`);
  console.log(`url: ${opts.url}`);

  const t0 = Date.now();
  const html = await request({
    ...opts,
    headless: HEADFUL ? false : opts.headless,
    onCreatedPage: async (page) => {
      if (capture) attachCapture(page, caseDir, manifest);
      if (opts.onCreatedPage) await opts.onCreatedPage(page);
    },
  });

  const ms = Date.now() - t0;

  writeText(join(caseDir, 'html', 'page.html'), html);

  manifest.durationMs = ms;
  manifest.htmlBytes = Buffer.byteLength(html, 'utf8');
  manifest.finishedAt = new Date().toISOString();

  writeText(join(caseDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`saved: ${join(caseDir, 'html', 'page.html')}`);
  console.log(`bytes: ${manifest.htmlBytes}`);
  console.log(`time:  ${ms}ms`);
  if (capture)
    console.log(
      `captured responses: ${manifest.responses.length} (see manifest.json)`
    );
}

async function runComponents(runDir) {
  console.log(`\n=== components_slices ===`);
  const selectors = ['head', 'header', 'main', 'footer', 'body'];

  const caseDir = makeCaseDir(runDir, 'components_slices');
  const index = [];

  for (const sel of selectors) {
    // IMPORTANT: do not use manual mode here; it’s not needed and can timeout.
    const inner = await request({
      url: TARGET,
      wait: 'body',
      htmlSelector: sel,
    });

    const wrapped = `<${sel}>${inner}</${sel}>\n`;
    const file = join(caseDir, 'components', `${slug(sel)}.html`);
    writeText(file, wrapped);

    index.push({
      selector: sel,
      file: file.replaceAll('\\', '/'),
      bytes: Buffer.byteLength(wrapped, 'utf8'),
    });
  }

  writeText(
    join(caseDir, 'components', 'index.json'),
    JSON.stringify(index, null, 2)
  );
  console.log(`saved: ${join(caseDir, 'components')}`);
}

async function runManualInjected(runDir) {
  const FN = '__FUEGO_SNAPSHOT__';

  await runCase(runDir, 'manual_mode_injected', {
    url: TARGET,
    manually: FN,
    manualTimeoutMs: 60_000, // give SPA hydration more room
    onCreatedPage: async (page) => {
      page.once('domcontentloaded', () => {
        setTimeout(async () => {
          try {
            if (page.isClosed()) return;
            await page.evaluate((fnName) => {
              const fn = globalThis[fnName];
              if (typeof fn !== 'function') return;
              fn({ content: document.documentElement.outerHTML });
            }, FN);
          } catch {
            // ignore if page closes while timer fires
          }
        }, 2000);
      });
    },
  });
}

async function safe(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`\n[case failed] ${label}`);
    console.error(e);
  }
}

async function main() {
  const runDir = makeRunDir();
  console.log(`\nRun dir: ${runDir}\n`);

  await safe('basic', () => runCase(runDir, 'basic', { url: TARGET }));
  await safe('wait_selector_body', () =>
    runCase(runDir, 'wait_selector_body', { url: TARGET, wait: 'body' })
  );
  await safe('wait_1500ms', () =>
    runCase(runDir, 'wait_1500ms', { url: TARGET, wait: 1500 })
  );
  await safe('htmlSelector_body', () =>
    runCase(runDir, 'htmlSelector_body', { url: TARGET, htmlSelector: 'body' })
  );
  await safe('minify_true', () =>
    runCase(runDir, 'minify_true', { url: TARGET, minify: true })
  );

  await safe('resourceFilter_block_analytics', () =>
    runCase(runDir, 'resourceFilter_block_analytics', {
      url: TARGET,
      resourceFilter: ({ url }) => {
        const u = url.toLowerCase();
        if (
          u.includes('googletagmanager') ||
          u.includes('google-analytics') ||
          u.includes('gtag') ||
          u.includes('segment') ||
          u.includes('hotjar') ||
          u.includes('clarity.ms')
        ) {
          return false;
        }
        return true;
      },
    })
  );

  await safe('blockCrossOrigin_true', () =>
    runCase(runDir, 'blockCrossOrigin_true', {
      url: TARGET,
      blockCrossOrigin: true,
    })
  );

  await safe('hooks_headful', () =>
    runCase(runDir, 'hooks_headful', {
      url: TARGET,
      headless: false,
      onBeforeRequest: (url) => console.log('onBeforeRequest:', url),
      onAfterRequest: (url) => console.log('onAfterRequest:', url),
      onCreatedPage: async (page) => {
        await page.setViewportSize({ width: 1280, height: 720 });
      },
    })
  );

  await safe('capture_assets_full', () =>
    runCase(
      runDir,
      'capture_assets_full',
      { url: TARGET, wait: 1500, blockResourceTypes: false },
      { capture: true }
    )
  );

  await safe('components_slices', () => runComponents(runDir));
  await safe('manual_mode_injected', () => runManualInjected(runDir));

  await cleanup();
  console.log('\nDone.');
}

main().catch(async (err) => {
  console.error(err);
  await cleanup();
  process.exit(1);
});
