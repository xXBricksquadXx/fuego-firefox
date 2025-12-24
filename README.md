<img width="1536" height="543" alt="fuego-firefox" src="https://github.com/user-attachments/assets/886b64f4-f3d7-476e-8e79-a3d29ac58afe" />

---
HTML snapshot / prerender via Playwright (Firefox).
</br>

[ C͗ͅr̬͕͉̩ͮeͧ̏͑̿d̊̚i͓̹̻͍ͮ̒̒ͭt̝̖͔̓͌͋ͪ\Ĩ͔̟͚̯͌ͦň̺̼̜͊s̉̅p͖̖̘ͫ̏̈́̚i͓̹̻͍ͮ̒̒ͭr̬͕͉̩ͮaͪ͊͆t̝̖͔̓͌͋ͪi͓̹̻͍ͮ̒̒ͭõ͍ň̺̼̜͊ ](https://github.com/egoist/taki) (the original “tiny prerender” utility), but modernized around:

- Playwright (Firefox)
- npm-only workflow
- TS build output (ESM + CJS via `tsdown`)
- a demo runner that can capture assets + generate an offline “smoke” page
- run reports (`demo:report`) for quick verification

---

## What this tool is for

Given a URL, it produces an HTML snapshot suitable for:

- quick SEO/prerender checks
- build-time content snapshots
- debugging hydration/client-render differences
- generating “offline-ish” smoke pages to validate what you captured

It is **not** a full recursive crawler. The “capture assets” mode captures responses seen during page load for a single page.

---

## Repo layout

```
src/
  browser.ts     # singleton Firefox launcher (Playwright)
  request.ts     # main request() that returns HTML
  utils.ts
examples/
  demo.mjs       # demo runner: cases + capture + smoke
  report.mjs     # generates report.html + report.json for latest run
  clean.mjs      # wipes .demo-out
test/
dist/            # build output
.demo-out/       # demo outputs (gitignored)
```

---

## Install

```pwsh
npm install
npm run demo:install     # installs Playwright’s Firefox runtime
```

---

## Build / Test

```pwsh
npm run build
npm test
```

---

## Demo: start-to-finish workflow

### 1) Start clean

```pwsh
npm run demo:clean
```

### 2) Run capture (best “smoke test” case)

`capture_assets_full` is the main “offline verification” case.

```pwsh
npm run demo:minify-js -- --only capture_assets_full --goto domcontentloaded --gotoTimeout 120000 --wait 2500
```

Notes:

- `--goto domcontentloaded` avoids hanging on `networkidle` (modern sites often never go idle).
- `--wait 2500` gives the page time to load extra JS/CSS after initial navigation.

### 3) Generate report

```pwsh
npm run demo:report
```

### 4) Open the latest report (PowerShell)

```pwsh
$latest = Get-ChildItem .demo-out\runs | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$report = Join-Path $latest.FullName "report.html"
ii $report
```

The report includes:

- **page** link: raw snapshot HTML
- **smoke** link: locally-rewritten + inlined CSS/JS (when capture was enabled)

---

## Demo runner CLI flags

All demo flags are passed to `examples/demo.mjs`.

### Target

- `--url https://rosehillops.com/`

### Select cases

- `--only capture_assets_full`
- `--skip manual_mode_injected`

Comma-separated lists work:

- `--only capture_assets_full,components_slices`

### Capture behavior / timeouts

- `--goto domcontentloaded|load|networkidle`
- `--gotoTimeout 120000`
- `--wait 2500`

### JS minify / chunks

- `--minify-js`
- `--chunk-js 20000`

Outputs are written under each case:

- `assets/js/` (captured raw)
- `assets/js-min/` (terser minified)
- `assets/js-chunks/` (minified split into readable chunks)

### Debug logging

This repo uses debug namespace:

- `fuego:request`

Option A: enable via demo flag:

```pwsh
npm run demo:debug
```

Option B: enable manually (PowerShell):

```pwsh
$env:DEBUG="fuego:*"
npm run demo
```

---

## Output structure & naming conventions

Each demo run is written to:

```
.demo-out/runs/<YYYYMMDD_HHMMSS>__<host>/
  run.json
  report.json
  report.html
  cases/
    <case_name>/
      manifest.json
      html/page.html
      assets/...
      cdn/...
      offline/smoke.html
      components/...
```

Key files:

- `run.json` – run-level metadata (target, args, timestamps)
- `cases/<case>/manifest.json` – per-case capture log (responses, failures, console, errors)
- `report.json` / `report.html` – summary view for the latest run
- `offline/smoke.html` – browser verification page (CSS/JS inlined when captured)

---

## Library API (programmatic)

```ts
import { request, cleanup } from 'fuego-firefox';

const html = await request({
  url: 'https://rosehillops.com/',
  minify: true,
});

await cleanup();
```

Important options:

- `blockedResourceTypes?: string[]`

  - Default blocks `stylesheet,image,media,font` (fast snapshots)
  - Set to `[]` to allow full capture workflows

- `gotoWaitUntil?: "load" | "domcontentloaded" | "networkidle"`
- `gotoTimeoutMs?: number`
- `wait?: number | string` (delay ms or wait-for-selector)
- `manually?: boolean | string` (manual snapshot mode)

---

## Common recipes (PowerShell)

### Quick HTML snapshot (fast)

```pwsh
npm run demo -- --only basic
```

### Full capture + smoke page + report

```pwsh
npm run demo:clean
npm run demo:minify-js -- --only capture_assets_full --goto domcontentloaded --gotoTimeout 120000 --wait 2500
npm run demo:report
```

### Only components slicing

```pwsh
npm run demo -- --only components_slices --goto domcontentloaded --gotoTimeout 120000
```
