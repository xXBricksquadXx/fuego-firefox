import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, dirname, relative, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const raw = a.slice(2);
    const eq = raw.indexOf('=');
    const k = (eq >= 0 ? raw.slice(0, eq) : raw).replace(/-([a-z])/g, (_, c) =>
      c.toUpperCase()
    );
    const v =
      eq >= 0
        ? raw.slice(eq + 1)
        : argv[i + 1] && !argv[i + 1].startsWith('--')
        ? argv[++i]
        : true;
    out[k] = v;
  }
  return out;
}

function nowId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function slug(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function sha1(s) {
  return createHash('sha1').update(s).digest('hex').slice(0, 10);
}

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function listDirs(p) {
  if (!existsSync(p)) return [];
  return readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(p, d.name));
}

// Minimal recursive file walker (used for JS minify)
function walkFiles(root, exts) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || !existsSync(cur)) continue;
    for (const ent of readdirSync(cur, { withFileTypes: true })) {
      const abs = join(cur, ent.name);
      if (ent.isDirectory()) stack.push(abs);
      else if (ent.isFile() && exts.has(extname(ent.name))) out.push(abs);
    }
  }
  return out;
}

function chooseBucket({ url, type, contentType }) {
  const u = url.toLowerCase();
  const ct = (contentType ?? '').toLowerCase();

  if (type === 'stylesheet' || ct.includes('text/css') || u.endsWith('.css'))
    return 'css';
  if (
    type === 'script' ||
    ct.includes('javascript') ||
    u.endsWith('.js') ||
    u.endsWith('.mjs')
  )
    return 'js';
  if (ct.startsWith('image/') || type === 'image') return 'img';
  if (ct.startsWith('font/') || type === 'font') return 'font';
  if (ct.includes('json') || u.endsWith('.json')) return 'json';
  return 'other';
}

function filenameFor(url, contentType) {
  let ext = extname(new URL(url).pathname);
  if (!ext) {
    const ct = (contentType ?? '').toLowerCase();
    if (ct.includes('text/css')) ext = '.css';
    else if (ct.includes('javascript')) ext = '.js';
    else if (ct.includes('json')) ext = '.json';
    else if (ct.startsWith('image/'))
      ext = `.${ct.split('/')[1].split(';')[0]}`;
    else if (ct.startsWith('font/')) ext = `.${ct.split('/')[1].split(';')[0]}`;
    else ext = '.bin';
  }
  const base = basename(new URL(url).pathname) || 'asset';
  const cleanBase = slug(base.replace(extname(base), '')) || 'asset';
  return `${cleanBase}_${sha1(url)}${ext}`;
}

function relFrom(baseDir, absPath) {
  return toPosix(relative(baseDir, absPath));
}

function inlineOrRelPath({
  fromDir,
  caseDir,
  urlMap,
  absUrl,
  inline,
  maxInlineBytes,
}) {
  const relPath = urlMap.get(absUrl);
  if (!relPath) return { kind: 'none' };

  const absPath = join(caseDir, relPath);
  if (!existsSync(absPath)) return { kind: 'none' };

  const buf = readFileSync(absPath);
  if (inline && buf.length <= maxInlineBytes) {
    return { kind: 'inline', text: buf.toString('utf8') };
  }

  const rel = relFrom(fromDir, absPath);
  return { kind: 'link', href: rel };
}

function buildSmokeHtml({
  html,
  caseDir,
  urlMap,
  targetUrl,
  maxInlineBytes = 800_000,
}) {
  const offlineDir = join(caseDir, 'offline');
  mkdirSync(offlineDir, { recursive: true });

  const fromDir = offlineDir;

  // Inline CSS
  html = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, (tag) => {
    const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefMatch) return tag;

    const absUrl = new URL(hrefMatch[1], targetUrl).toString();
    const r = inlineOrRelPath({
      fromDir,
      caseDir,
      urlMap,
      absUrl,
      inline: true,
      maxInlineBytes,
    });

    if (r.kind === 'inline') {
      return `<style data-href="${hrefMatch[1]}">\n${r.text}\n</style>`;
    }
    if (r.kind === 'link') {
      return tag.replace(hrefMatch[1], r.href);
    }
    return tag;
  });

  // Inline JS
  html = html.replace(
    /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (m, pre, src, post) => {
      const absUrl = new URL(src, targetUrl).toString();
      const r = inlineOrRelPath({
        fromDir,
        caseDir,
        urlMap,
        absUrl,
        inline: true,
        maxInlineBytes,
      });

      if (r.kind === 'inline') {
        // Keep attributes except src=
        const attrs = `${pre} ${post}`.replace(/\s+/g, ' ').trim();
        return `<script ${attrs} data-src="${src}">\n${r.text}\n</script>`;
      }
      if (r.kind === 'link') {
        return m.replace(src, r.href);
      }
      return m;
    }
  );

  // Rewrite <img src> to local if captured (don’t inline)
  html = html.replace(
    /<img\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>/gi,
    (m, pre, src, post) => {
      const absUrl = new URL(src, targetUrl).toString();
      const r = inlineOrRelPath({
        fromDir,
        caseDir,
        urlMap,
        absUrl,
        inline: false,
        maxInlineBytes,
      });
      if (r.kind === 'link') return m.replace(src, r.href);
      return m;
    }
  );

  return html;
}

async function maybeMinifyJs({ caseDir, enabled, chunkJs }) {
  if (!enabled) return;

  // dynamic import to avoid cost when not used
  const { minify } = await import('terser');

  const jsRoots = [
    join(caseDir, 'assets', 'js'),
    ...listDirs(join(caseDir, 'cdn')).map((h) => join(h, 'js')),
  ];

  for (const root of jsRoots) {
    if (!existsSync(root)) continue;

    const files = walkFiles(root, new Set(['.js', '.mjs']));
    if (!files.length) continue;

    const outMin = root
      .replace(/\/js$/i, '/js-min')
      .replace(/\\js$/i, '\\js-min');
    const outChunks = root
      .replace(/\/js$/i, '/js-chunks')
      .replace(/\\js$/i, '\\js-chunks');
    mkdirSync(outMin, { recursive: true });
    mkdirSync(outChunks, { recursive: true });

    for (const f of files) {
      const code = readFileSync(f, 'utf8');
      const r = await minify(code, { compress: true, mangle: true });
      const min = r.code ?? code;

      const name = basename(f);
      const minPath = join(outMin, name);
      writeFileSync(minPath, min, 'utf8');

      if (chunkJs && Number(chunkJs) > 0) {
        const size = Number(chunkJs);
        const chunks = Math.ceil(min.length / size);
        for (let i = 0; i < chunks; i++) {
          const part = min.slice(i * size, (i + 1) * size);
          const partName = `${name}.part${String(i + 1).padStart(3, '0')}.js`;
          writeFileSync(join(outChunks, partName), part, 'utf8');
        }
      }
    }
  }
}

function sliceComponents({ html, caseDir }) {
  const outDir = join(caseDir, 'components');
  mkdirSync(outDir, { recursive: true });

  // Very simple “component” slicing: sections + header/footer/main
  const parts = [];

  const grab = (re, label) => {
    let m;
    let i = 0;
    while ((m = re.exec(html))) {
      i++;
      parts.push({
        name: `${label}_${String(i).padStart(3, '0')}`,
        html: m[0],
      });
    }
  };

  grab(/<header\b[\s\S]*?<\/header>/gi, 'header');
  grab(/<main\b[\s\S]*?<\/main>/gi, 'main');
  grab(/<section\b[\s\S]*?<\/section>/gi, 'section');
  grab(/<footer\b[\s\S]*?<\/footer>/gi, 'footer');

  // fallback: if nothing matched, dump body
  if (!parts.length) {
    parts.push({ name: 'document_001', html });
  }

  const index = [];
  for (const p of parts) {
    const file = join(outDir, `${p.name}.html`);
    writeFileSync(file, p.html, 'utf8');
    index.push({
      file: toPosix(relative(caseDir, file)),
      name: p.name,
      bytes: Buffer.byteLength(p.html, 'utf8'),
    });
  }

  writeFileSync(
    join(outDir, 'index.json'),
    JSON.stringify(index, null, 2),
    'utf8'
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const targetUrl = String(args.url ?? 'https://rosehillops.com/');
  const outRoot = String(args.out ?? '.demo-out');

  const only = args.only
    ? new Set(String(args.only).split(',').map(slug))
    : null;
  const skip = args.skip
    ? new Set(String(args.skip).split(',').map(slug))
    : new Set();

  const runDir = (() => {
    const host = slug(new URL(targetUrl).hostname);
    return join(outRoot, 'runs', `${nowId()}__${host}`);
  })();

  mkdirSync(join(runDir, 'cases'), { recursive: true });

  // Allow `--debug` to work (must be set before importing dist)
  if (args.debug) {
    process.env.DEBUG = process.env.DEBUG || 'fuego:*';
  }

  const { request, cleanup } = await import('../dist/index.mjs');

  const runMeta = {
    target: targetUrl,
    startedAt: new Date().toISOString(),
    args,
  };
  writeFileSync(
    join(runDir, 'run.json'),
    JSON.stringify(runMeta, null, 2),
    'utf8'
  );

  console.log(`\nRun dir: ${runDir}\n`);

  const cases = [
    {
      name: 'basic',
      opts: () => ({ url: targetUrl }),
    },
    {
      name: 'wait_selector_body',
      opts: () => ({ url: targetUrl, wait: 'body' }),
    },
    {
      name: 'wait_1500ms',
      opts: () => ({ url: targetUrl, wait: 1500 }),
    },
    {
      name: 'htmlSelector_body',
      opts: () => ({ url: targetUrl, htmlSelector: 'body' }),
    },
    {
      name: 'minify_true',
      opts: () => ({ url: targetUrl, minify: true }),
    },
    {
      name: 'resourceFilter_block_analytics',
      opts: () => ({
        url: targetUrl,
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
      }),
    },
    {
      name: 'blockCrossOrigin_true',
      opts: () => ({ url: targetUrl, blockCrossOrigin: true }),
    },
    {
      name: 'hooks_headful',
      opts: () => ({
        url: targetUrl,
        headless: args.headful ? false : false, // keep this one headful by design
        onBeforeRequest: (url) => console.log('onBeforeRequest:', url),
        onAfterRequest: (url) => console.log('onAfterRequest:', url),
        onCreatedPage: async (page) => {
          await page.setViewportSize({ width: 1280, height: 720 });
        },
      }),
    },
    {
      name: 'capture_assets_full',
      capture: true,
      opts: () => ({
        url: targetUrl,
        // IMPORTANT: don't hang on networkidle for capture workflows
        gotoWaitUntil: String(args.goto ?? 'domcontentloaded'),
        gotoTimeoutMs: args.gotoTimeout ? Number(args.gotoTimeout) : 60_000,
        wait: args.wait ? Number(args.wait) : 2500,
        // IMPORTANT: allow CSS/img/fonts so we can build an offline smoke page
        blockedResourceTypes: [],
      }),
    },
    {
      name: 'components_slices',
      post: ({ html, caseDir }) => {
        sliceComponents({ html, caseDir });
      },
      opts: () => ({
        url: targetUrl,
        gotoWaitUntil: 'domcontentloaded',
        gotoTimeoutMs: 60_000,
        blockedResourceTypes: [],
      }),
    },
    {
      name: 'manual_mode_injected',
      opts: () => ({
        url: targetUrl,
        manually: true,
        manualTimeoutMs: 30_000,
        gotoWaitUntil: 'domcontentloaded',
        gotoTimeoutMs: 60_000,
        onAfterGoto: async (page) => {
          await page.waitForLoadState('load');
          await page.waitForTimeout(1500);
          await page.evaluate(() => {
            // calls the exposed function (default name: snapshot)
            window.snapshot({ content: document.documentElement.outerHTML });
          });
        },
      }),
    },
  ];

  async function runCase(c) {
    const nameSlug = slug(c.name);

    if (only && !only.has(nameSlug)) return;
    if (skip.has(nameSlug)) return;

    const caseDir = join(runDir, 'cases', nameSlug);

    const htmlDir = join(caseDir, 'html');
    const assetsDir = join(caseDir, 'assets');
    const cdnDir = join(caseDir, 'cdn');
    const offlineDir = join(caseDir, 'offline');

    mkdirSync(htmlDir, { recursive: true });
    mkdirSync(assetsDir, { recursive: true });
    mkdirSync(cdnDir, { recursive: true });
    mkdirSync(offlineDir, { recursive: true });

    const manifest = {
      name: nameSlug,
      url: targetUrl,
      startedAt: new Date().toISOString(),
      capture: Boolean(c.capture),
      responses: [],
      failed: [],
      console: [],
      errors: [],
      durationMs: 0,
      htmlBytes: 0,
      finishedAt: '',
      smokePath: null,
    };

    const urlMap = new Map();

    const start = Date.now();
    console.log(`\n=== ${nameSlug} ===`);
    console.log(`url: ${targetUrl}`);

    let pending = new Set();

    const captureHooks = c.capture
      ? {
          onCreatedPage: async (page) => {
            page.on('console', (msg) => {
              manifest.console.push({ type: msg.type(), text: msg.text() });
            });

            page.on('pageerror', (err) => {
              manifest.errors.push({
                message: String(err?.message ?? err),
                stack: String(err?.stack ?? ''),
              });
            });

            page.on('requestfailed', (req) => {
              manifest.failed.push({
                url: req.url(),
                type: req.resourceType(),
                reason: req.failure()?.errorText ?? 'requestfailed',
              });
            });

            page.on('response', (res) => {
              const p = (async () => {
                const req = res.request();
                const url = res.url();
                const type = req.resourceType();
                const status = res.status();
                const headers = res.headers();
                const contentType = headers['content-type'] ?? '';

                // Redirects typically have no body worth saving
                if (status >= 300 && status < 400) return;

                let body;
                try {
                  body = await res.body();
                } catch (e) {
                  manifest.failed.push({
                    url,
                    type,
                    reason: 'body_failed',
                    error: String(e),
                  });
                  return;
                }

                const host = new URL(url).hostname;
                const targetHost = new URL(targetUrl).hostname;
                const base =
                  host === targetHost
                    ? 'assets'
                    : toPosix(join('cdn', slug(host)));

                const bucket = chooseBucket({ url, type, contentType });
                const fname = filenameFor(url, contentType);
                const relPath = toPosix(join(base, bucket, fname));
                const absPath = join(caseDir, relPath);

                mkdirSync(dirname(absPath), { recursive: true });
                writeFileSync(absPath, body);

                urlMap.set(url, relPath);

                manifest.responses.push({
                  url,
                  type,
                  status,
                  contentType,
                  bytes: body.length,
                  path: relPath,
                });
              })();

              pending.add(p);
              p.finally(() => pending.delete(p));
            });
          },

          onBeforeClosingPage: async () => {
            // Flush captured responses before request.ts closes the page/context
            await Promise.allSettled([...pending]);
          },
        }
      : {};

    try {
      const opts = c.opts();

      const html = await request({
        ...opts,
        ...captureHooks,
      });

      const ms = Date.now() - start;
      manifest.durationMs = ms;

      const pagePath = join(htmlDir, 'page.html');
      writeFileSync(pagePath, html, 'utf8');
      manifest.htmlBytes = Buffer.byteLength(html, 'utf8');

      // build smoke page if we captured anything
      if (manifest.capture && manifest.responses.length) {
        const smokeHtml = buildSmokeHtml({
          html,
          caseDir,
          urlMap,
          targetUrl,
          maxInlineBytes: args.maxInline ? Number(args.maxInline) : 800_000,
        });

        const smokePath = join(offlineDir, 'smoke.html');
        writeFileSync(smokePath, smokeHtml, 'utf8');
        manifest.smokePath = toPosix(relative(caseDir, smokePath));
      }

      // post-processing (components slicing etc.)
      if (c.post) {
        await c.post({ html, caseDir });
      }

      // optional JS minify/chunk for captured runs
      await maybeMinifyJs({
        caseDir,
        enabled: Boolean(args.minifyJs),
        chunkJs: args.chunkJs ? Number(args.chunkJs) : 0,
      });

      manifest.finishedAt = new Date().toISOString();

      writeFileSync(
        join(caseDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
      );

      console.log(`saved: ${toPosix(relative(runDir, pagePath))}`);
      console.log(`bytes: ${manifest.htmlBytes}`);
      console.log(`time:  ${ms}ms`);
      if (manifest.capture)
        console.log(
          `captured responses: ${manifest.responses.length} (see manifest.json)`
        );
      if (manifest.smokePath)
        console.log(
          `smoke: ${toPosix(
            relative(runDir, join(caseDir, manifest.smokePath))
          )}`
        );
    } catch (err) {
      manifest.finishedAt = new Date().toISOString();
      manifest.errors.push({
        message: String(err?.message ?? err),
        stack: String(err?.stack ?? ''),
      });

      writeFileSync(
        join(caseDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
      );

      console.error(`\n[case failed] ${nameSlug}`);
      console.error(err);
    }
  }

  for (const c of cases) {
    await runCase(c);
  }

  await cleanup();
  console.log('\nDone.');
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
