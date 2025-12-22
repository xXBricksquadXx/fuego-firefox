import { firefox, type Browser } from "playwright-firefox";

export type BrowserOptions = {
  proxy?: string;
  headless?: boolean;
};

let browser: Browser | undefined;
let lastKey: string | undefined;

function keyFor(opts: BrowserOptions) {
  return JSON.stringify({
    proxy: opts.proxy ?? null,
    headless: opts.headless ?? true
  });
}

export async function getOrCreateBrowser(opts: BrowserOptions): Promise<Browser> {
  const key = keyFor(opts);

  // If launch-critical options change, rotate the browser.
  if (browser && lastKey !== key) {
    await browser.close();
    browser = undefined;
    lastKey = undefined;
  }

  if (!browser) {
    browser = await firefox.launch({
      headless: opts.headless ?? true,
      proxy: opts.proxy ? { server: opts.proxy } : undefined
    });
    lastKey = key;
  }

  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = undefined;
    lastKey = undefined;
  }
}

export function peekBrowser(): Browser | undefined {
  return browser;
}
