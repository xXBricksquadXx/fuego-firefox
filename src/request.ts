import debug from "debug";
import type { Browser, Page } from "playwright-firefox";
import { minify as minifyHTML } from "html-minifier-terser";
import type { Options as MinifyOptions } from "html-minifier-terser";
import { closeBrowser, getOrCreateBrowser, peekBrowser, type BrowserOptions } from "./browser.js";
import { safeURL } from "./utils.js";
const debugRequest = debug("fuego:request");
export type ResourceFilterCtx = { url: string; type: string };
export type GotoWaitUntil = "load" | "domcontentloaded" | "networkidle";
const DEFAULT_BLOCKED_RESOURCE_TYPES = ["stylesheet", "image", "media", "font"] as const;
export type RequestOptions = BrowserOptions & {
  url: string;
  manually?: string | boolean;
  wait?: string | number;
  onBeforeRequest?: (url: string) => void;
  onAfterRequest?: (url: string) => void;
  onCreatedPage?: (page: Page) => void | Promise<void>;
  onAfterGoto?: (page: Page) => void | Promise<void>;
  onBeforeClosingPage?: (page: Page) => void | Promise<void>;
  minify?: boolean | MinifyOptions;
  htmlSelector?: string;
  resourceFilter?: (ctx: ResourceFilterCtx) => boolean;
  blockCrossOrigin?: boolean;
  blockedResourceTypes?: string[];
  gotoWaitUntil?: GotoWaitUntil;
  gotoTimeoutMs?: number;
  userAgent?: string;
  manualTimeoutMs?: number;
};
const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_3) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/140.0 Prerender";
async function readContent(page: Page, options: RequestOptions) {
  if (options.htmlSelector) {
    return page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`htmlSelector not found: ${sel}`);
      return el.innerHTML;
    }, options.htmlSelector);
  }
  return page.content();
}
async function getHTML(browser: Browser, options: RequestOptions): Promise<string> {
  options.onBeforeRequest?.(options.url);
  const ctx = await browser.newContext({
    userAgent: options.userAgent ?? DEFAULT_UA,
  });
  const page = await ctx.newPage();
  const blocked = new Set(options.blockedResourceTypes ?? [...DEFAULT_BLOCKED_RESOURCE_TYPES]);
  try {
    if (options.onCreatedPage) await options.onCreatedPage(page);
    const root = safeURL(options.url);
    await page.route("**/*", async (route) => {
      const req = route.request();
      const type = req.resourceType();
      const resourceURL = req.url();
      const abort = async () => {
        debugRequest(`Aborted: ${resourceURL}`);
        await route.abort();
      };
      const next = async () => {
        debugRequest(`Fetched: ${resourceURL}`);
        await route.continue();
      };
      if (options.blockCrossOrigin && root) {
        const u = safeURL(resourceURL);
        if (!u || u.host !== root.host) return abort();
      }
      if (blocked.has(type)) return abort();
      if (options.resourceFilter && !options.resourceFilter({ url: resourceURL, type })) {
        return abort();
      }
      return next();
    });
    type Result = { content: string };
    let resolveResult: ((r: Result) => void) | undefined;
    const resultPromise = new Promise<Result>((resolve) => {
      resolveResult = resolve;
    });
    if (options.manually) {
      const fnName = typeof options.manually === "string" ? options.manually : "snapshot";
      await page.exposeFunction(fnName, (result: Result) => resolveResult?.(result));
    }
    const waitUntil: GotoWaitUntil =
      options.gotoWaitUntil ??
      (options.manually ? "domcontentloaded" : "networkidle");
    await page.goto(options.url, {
      waitUntil,
      timeout: options.gotoTimeoutMs ?? 30_000,
    });
    if (options.onAfterGoto) {
      await options.onAfterGoto(page);
    }
    let content: string;
    if (options.manually) {
      const t = options.manualTimeoutMs ?? 30_000;
      const result =
        t > 0
          ? await Promise.race<Result>([
              resultPromise,
              new Promise<Result>((_, rej) =>
                setTimeout(() => rej(new Error(`Manual snapshot timed out after ${t}ms`)), t),
              ),
            ])
          : await resultPromise;
      content = result.content;
    } else if (typeof options.wait === "number") {
      await page.waitForTimeout(options.wait);
      content = await readContent(page, options);
    } else if (typeof options.wait === "string") {
      await page.waitForSelector(options.wait);
      content = await readContent(page, options);
    } else {
      content = await readContent(page, options);
    }
    if (options.onBeforeClosingPage) await options.onBeforeClosingPage(page);
    if (!options.minify) return content;
    const minifyOptions: MinifyOptions =
      typeof options.minify === "object"
        ? options.minify
        : {
            minifyCSS: true,
            minifyJS: true,
            collapseWhitespace: true,
            decodeEntities: true,
            removeComments: true,
            removeAttributeQuotes: true,
            removeScriptTypeAttributes: true,
            removeRedundantAttributes: true,
            removeStyleLinkTypeAttributes: true,
          };
    return minifyHTML(content, minifyOptions);
  } finally {
    try {
      options.onAfterRequest?.(options.url);
    } catch {
    }
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
}
export async function request(options: RequestOptions) {
  const browser = await getOrCreateBrowser({
    proxy: options.proxy,
    headless: options.headless,
  });
  return getHTML(browser, options);
}
export async function cleanup() {
  await closeBrowser();
}
export function getBrowser() {
  return peekBrowser();
}