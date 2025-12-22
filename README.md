# fuego-firefox

A **taki-inspired** HTML snapshot / prerender utility that uses **Playwright (Firefox)**.

- Loads a URL in a real browser
- Optionally waits for hydration / a selector / a fixed delay
- Returns the resulting HTML (optionally minified)
- Includes an **examples/demo** harness that can also capture assets (CSS/JS/images/fonts), minify JS, and chunk large JS into readable pieces.

Inspired by `egoist/taki`.

---

## What this repo is for (original intent)

The original “taki” pattern is optimized for **prerendering JS-heavy pages**:

- Get a stable HTML snapshot for SEO, preview, or static export.
- Keep the snapshot fast and repeatable by **blocking heavy resources by default** (CSS/images/fonts/media).
- Provide flexible “ready” logic:

  - automatic (`networkidle`)
  - wait for selector
  - wait fixed milliseconds
  - **manual** “I’m ready” signal from the page (`window.snapshot({content})`)

This repo keeps that intent, but modernizes:

- Firefox-based Playwright runtime
- ESM/CJS dual exports
- Vitest for tests
- tsdown for build
- Biome for lint/format
- A demo harness that produces **organized per-run/per-case output**

---

## Requirements

- Node `>= 20.19`
- npm
- Playwright Firefox browser runtime

---

## Install

```bash
npm install
npm run pw:install
```

---

## Build

```bash
npm run build
```

Artifacts go to `dist/`.

---

## Library usage

```js
import { request, cleanup } from 'fuego-firefox';

const html = await request({
  url: 'https://example.com',
  wait: 'body', // or 1500, or omit
  minify: true,
});

await cleanup();
```

### Key options (RequestOptions)

- `url` (string) – required
- `wait` (string | number)

  - selector: `"#app"`
  - delay: `1500`

- `htmlSelector` (string)

  - returns `innerHTML` of the matched element

- `minify` (boolean | html-minifier-terser options)
- `blockCrossOrigin` (boolean)

  - aborts cross-origin requests (often breaks modern sites)

- `resourceFilter` ({ url, type } => boolean)

  - fine-grained allow/block per request

- `blockResourceTypes` (false | string[])

  - **default:** blocks `stylesheet,image,media,font`
  - `false` = don’t block by type (fetch CSS/images/fonts too)

Hooks:

- `onBeforeRequest(url)` / `onAfterRequest(url)`
- `onCreatedPage(page)` / `onBeforeClosingPage(page)`

Manual mode:

- `manually: true | "functionName"`
- `manualTimeoutMs` (default 30s)

Manual mode waits until the page calls the exposed function, e.g. `__FUEGO_SNAPSHOT__({ content: "..." })`.

---

## Demo harness

The demo generates a **run folder** with multiple “cases”. Each case is a snapshot job.

### Run the demo

```bash
npm run demo
```

### Clean previous outputs

```bash
npm run demo:clean
```

### Headful (shows Firefox)

```bash
npm run demo:headful
```

### JS minify + chunking

```bash
npm run demo:minify-js

# Force smaller chunk sizes so you see more js-chunks
npm run demo:minify-js -- --chunk-js 20000
```

### Target a different URL

```bash
npm run demo -- --url https://rosehillops.com/
```

### Debug logs

PowerShell:

```powershell
$env:DEBUG="fuego:*"
npm run demo
```

---

## Output layout

Runs are stored under:

```
.demo-out/
  runs/
    <YYYYMMDD_HHMMSS__host>/
      run.json
      cases/
        <case-name>/
          html/page.html
          manifest.json
          components/
          assets/
            css/
            js/
            js-min/
            js-chunks/
            img/
            font/
            json/
            other/
          cdn/
            <cdn-host>/...
```

### How to read a case

- `manifest.json` is the “truth”:

  - duration, html bytes
  - captured responses and file paths (for capture jobs)
  - request failures
  - console output

### Cases included by default

- `basic` – simple snapshot
- `wait_selector_body` – waits for `body`
- `wait_1500ms` – fixed delay
- `htmlSelector_body` – returns `body.innerHTML`
- `minify_true` – HTML minified output
- `resourcefilter_block_analytics` – example allow/block
- `blockcrossorigin_true` – cross-origin block demo
- `hooks_headful` – hook demo (headful)
- `capture_assets_full` – captures CSS/JS/images/fonts + optional JS minify + chunking
- `components_slices` – saves slices for `head/header/main/footer/body`
- `manual_mode_injected` – demonstrates manual snapshot callback

---

## Start-to-finish workflow

1. Install + browser runtime

```bash
npm install
npm run pw:install
```

2. Clean old runs

```bash
npm run demo:clean
```

3. Run a full capture job with JS minify + chunking

```bash
npm run demo:minify-js -- --chunk-js 20000
```

4. Inspect output

- open `.demo-out/runs/<latest>/run.json`
- review `cases/*/manifest.json`
- check:

  - `cases/capture_assets_full/assets/js-min/`
  - `cases/capture_assets_full/assets/js-chunks/`
  - `cases/components_slices/components/`

---

## Notes

- `capture_assets_full` is slower because it intentionally fetches CSS/images/fonts/JS and writes them to disk.
- `blockCrossOrigin` is mainly diagnostic; many sites rely on CDNs.
- Manual mode is useful for SPAs where “ready” is app-defined.

---

## License

MIT
