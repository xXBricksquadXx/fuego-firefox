# fuego-firefox

A minimal **HTML snapshot / prerender** utility powered by **Playwright (Firefox)**.

This project is a modern refactor inspired by **egoist/taki** (legacy Puppeteer/Chromium implementation):

- [https://github.com/egoist/taki](https://github.com/egoist/taki)

It keeps the same core idea:

- open a page
- optionally block heavy/irrelevant resources
- wait for the right moment
- return HTML (optionally minified)

…but swaps the stack to:

- **Playwright (Firefox)** instead of Puppeteer/Chromium
- **npm** (no Yarn)
- modern TypeScript + ESM build
- **Vitest** for snapshot tests
- **Biome** for formatting/lint

---

## Quick start

### Prereqs

- Node.js **20+**
- npm

### Clone → install → test

```bash
git clone <your-repo-url>
cd fuego-firefox

npm install

# Install the Firefox binary Playwright uses
npx playwright install firefox

# Run tests (starts a local fixture server)
npm test
```

### Build

```bash
npm run build
```

---

## Useful commands

| Command              | What it does                      |
| -------------------- | --------------------------------- |
| `npm test`           | Run the test suite once (Vitest)  |
| `npm run test:watch` | Watch mode for tests              |
| `npm run build`      | Build `dist/` (ESM + CJS + types) |
| `npm run dev`        | Build in watch mode               |
| `npm run fmt`        | Format codebase (Biome)           |
| `npm run lint`       | Lint/check codebase (Biome)       |
| `npm run pw:install` | Install Playwright Firefox binary |

---

## Project layout

```
fuego-firefox/
  src/
    index.ts        # public API exports
    browser.ts      # singleton browser lifecycle
    request.ts      # request() implementation
    utils.ts        # small helpers
  test/
    index.test.ts   # snapshot tests
    server/         # HTML fixtures
```

---

## Usage

### Basic snapshot

```ts
import { request, cleanup } from 'fuego-firefox';

const html = await request({
  url: 'https://example.com',
});

console.log(html);
await cleanup();
```

### Wait for a selector

```ts
const html = await request({
  url: 'https://example.com/app',
  wait: '#app-ready', // waits for selector
});
```

### Wait a fixed delay

```ts
const html = await request({
  url: 'https://example.com',
  wait: 1500, // ms
});
```

### Return only a subtree (`htmlSelector`)

```ts
const html = await request({
  url: 'https://example.com',
  htmlSelector: '#app', // returns innerHTML of #app
});
```

### Minify output

```ts
const html = await request({
  url: 'https://example.com',
  minify: true,
});
```

You can also pass minifier options:

```ts
const html = await request({
  url: 'https://example.com',
  minify: {
    collapseWhitespace: true,
    minifyCSS: true,
    minifyJS: true,
  },
});
```

---

## Manual mode (page-controlled snapshot)

Manual mode is useful when the page itself knows when it is “ready” (after custom hydration, API calls, etc.).

When `manually: true`, the browser exposes a function on `window` (default name `snapshot`). Your page calls it with `{ content }`.

```ts
const html = await request({
  url: 'https://example.com',
  manually: true,
  manualTimeoutMs: 30_000,
});
```

In the page:

```js
// somewhere in page JS
window.snapshot({ content: document.documentElement.outerHTML });
```

If you want a custom function name:

```ts
await request({
  url: 'https://example.com',
  manually: 'done',
});
```

Then the page calls:

```js
window.done({ content: document.documentElement.outerHTML });
```

---

## Request/response control

### Resource blocking

By default, these are blocked to speed things up:

- `stylesheet`
- `image`
- `media`
- `font`

You can add your own filter:

```ts
const html = await request({
  url: 'https://example.com',
  resourceFilter: ({ url, type }) => {
    // allow scripts + documents; block analytics
    if (url.includes('googletagmanager')) return false;
    return true;
  },
});
```

### Cross-origin blocking

```ts
const html = await request({
  url: 'https://example.com',
  blockCrossOrigin: true,
});
```

### Hooks

```ts
const html = await request({
  url: 'https://example.com',
  onBeforeRequest: (url) => console.log('start', url),
  onAfterRequest: (url) => console.log('done', url),
  onCreatedPage: async (page) => {
    // set cookies, localStorage, extra headers, etc.
    await page.setExtraHTTPHeaders({ 'X-Debug': '1' });
  },
  onBeforeClosingPage: async (page) => {
    // last-chance screenshots/logging, etc.
  },
});
```

---

## Browser lifecycle

- The library keeps a **singleton** Playwright browser instance.
- The instance is reused across multiple `request()` calls.
- Call `cleanup()` when your process is done.

```ts
import { request, cleanup, getBrowser } from 'fuego-firefox';

await request({ url: 'https://example.com' });
console.log(Boolean(getBrowser())); // true

await cleanup();
console.log(Boolean(getBrowser())); // false
```

---

## Options (API)

### `request(options)`

Required:

- `url: string`

Timing:

- `wait?: number | string` (ms or CSS selector)
- `manually?: boolean | string`
- `manualTimeoutMs?: number` (default `30000`, set `0` for no timeout)

HTML selection:

- `htmlSelector?: string` (returns `innerHTML` of selector)

Output:

- `minify?: boolean | MinifyOptions`

Network controls:

- `blockCrossOrigin?: boolean`
- `resourceFilter?: ({ url, type }) => boolean`

Browser controls:

- `headless?: boolean` (default `true`)
- `proxy?: string` (example: `"http://127.0.0.1:8080"`)
- `userAgent?: string`

Hooks:

- `onBeforeRequest?: (url) => void`
- `onAfterRequest?: (url) => void`
- `onCreatedPage?: (page) => void | Promise<void>`
- `onBeforeClosingPage?: (page) => void | Promise<void>`

---

## Development notes

- TypeScript module resolution uses `Bundler` mode, so internal imports omit file extensions.
- Build outputs are emitted to `dist/` as ESM + CJS, with type declarations.

---

## Troubleshooting

### Playwright can’t launch Firefox

Run:

```bash
npx playwright install firefox
```

On Linux CI you may also need:

```bash
npx playwright install-deps firefox
```

### Tests hang

If you’re using `manually: true`, make sure your page actually calls the exposed function (`window.snapshot(...)` by default). Otherwise the request will wait until `manualTimeoutMs`.

---

## License

MIT
