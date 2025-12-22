import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { request, cleanup } from '../dist/index.mjs';

const TARGET = 'https://rosehillops.com/';
const OUTDIR = '.demo-out';

mkdirSync(OUTDIR, { recursive: true });

function stamp(name) {
  const safe = name.replace(/[^a-z0-9-_]+/gi, '_').toLowerCase();
  return join(OUTDIR, `${Date.now()}_${safe}.html`);
}

async function runCase(name, opts) {
  const start = Date.now();
  console.log(`\n=== ${name} ===`);
  console.log(`url: ${opts.url}`);

  const html = await request(opts);

  const ms = Date.now() - start;
  const file = stamp(name);
  writeFileSync(file, html, 'utf8');

  console.log(`saved: ${file}`);
  console.log(`bytes: ${Buffer.byteLength(html, 'utf8')}`);
  console.log(`time:  ${ms}ms`);
}

async function main() {
  // 1) Basic snapshot (default: resource blacklist applies)
  await runCase('basic', {
    url: TARGET,
  });

  // 2) Wait for selector (safe selector: body)
  await runCase('wait_selector_body', {
    url: TARGET,
    wait: 'body',
  });

  // 3) Wait fixed delay
  await runCase('wait_1500ms', {
    url: TARGET,
    wait: 1500,
  });

  // 4) htmlSelector (returns innerHTML of body)
  await runCase('htmlSelector_body', {
    url: TARGET,
    htmlSelector: 'body',
  });

  // 5) Minify output
  await runCase('minify_true', {
    url: TARGET,
    minify: true,
  });

  // 6) Custom resource filter (example: block analytics)
  await runCase('resourceFilter_block_analytics', {
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
  });

  // 7) blockCrossOrigin (often breaks modern sites; useful to verify behavior)
  await runCase('blockCrossOrigin_true', {
    url: TARGET,
    blockCrossOrigin: true,
  });

  // 8) Hooks + visible browser (headless false)
  await runCase('hooks_headful', {
    url: TARGET,
    headless: false,
    onBeforeRequest: (url) => console.log('onBeforeRequest:', url),
    onAfterRequest: (url) => console.log('onAfterRequest:', url),
    onCreatedPage: async (page) => {
      // Example: set a header or viewport, if needed
      await page.setViewportSize({ width: 1280, height: 720 });
    },
  });

  // 9) Manual mode (inject a snapshot call after load + small delay)
  await runCase('manual_mode_injected', {
    url: TARGET,
    manually: true,
    manualTimeoutMs: 30000,
    onCreatedPage: async (page) => {
      page.on('load', async () => {
        // give client-side hydration a moment
        await page.waitForTimeout(2000);
        await page.evaluate(() => {
          // calls the exposed function (default name: snapshot)
          window.snapshot({ content: document.documentElement.outerHTML });
        });
      });
    },
  });

  await cleanup();
  console.log('\nDone.');
}

main().catch(async (err) => {
  console.error(err);
  await cleanup();
  process.exit(1);
});
