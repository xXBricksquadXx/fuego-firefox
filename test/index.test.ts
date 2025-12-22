import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sirv from "sirv";
import getPort from "get-port";

import { request, cleanup } from "../src/request";

function serve(): Server {
  const handler = sirv(join(__dirname, "server"));
  return createServer((req, res) => handler(req, res));
}

let server: Server;
let port: number;

beforeAll(async () => {
  server = serve();
  port = await getPort();
  await new Promise<void>((resolve) => server.listen(port, resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await cleanup();
});

describe("fuego-firefox", () => {
  it("basic", async () => {
    const html = await request({
      url: `http://localhost:${port}/basic.html`,
    });

    expect(html).toContain("<title>basic</title>");
    expect(html).toContain('id="hello"');
    expect(html).toContain(">Hello<");
  });

  it("minify", async () => {
    const raw = await request({
      url: `http://localhost:${port}/basic.html`,
    });

    const min = await request({
      url: `http://localhost:${port}/basic.html`,
      minify: true,
    });

    expect(min).toContain("<title>basic</title>");
    expect(min.length).toBeLessThan(raw.length);
  });

  it("wait for selector", async () => {
    const html = await request({
      url: `http://localhost:${port}/wait-for-selector.html`,
      wait: "#bar",
    });

    expect(html).toContain('id="bar"');
    expect(html).toContain("bar-ready");
  });

  it("manually", async () => {
    const html = await request({
      url: `http://localhost:${port}/manually.html`,
      manually: true,
      manualTimeoutMs: 10_000,
    });

    expect(html).toContain("manual-ok");
    expect(html).toContain("<title>manual</title>");
  });

  it("custom html selector", async () => {
    const inner = await request({
      url: `http://localhost:${port}/html-selector.html`,
      htmlSelector: "#app",
    });

    // htmlSelector returns innerHTML of #app (not full page)
    expect(inner).toContain('class="a"');
    expect(inner).toContain(">App<");
    expect(inner).not.toContain("<html");
  });
});
