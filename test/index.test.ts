import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";

import { beforeAll, afterAll, test, expect } from "vitest";
import sirv from "sirv";
import getPort from "get-port";

import { request, cleanup } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function serve() {
  const handler = sirv(join(__dirname, "server"));
  return createServer((req, res) => handler(req, res));
}

let server: Server;
let port: number;

beforeAll(async () => {
  server = serve();
  port = await getPort();
  server.listen(port);
});

afterAll(async () => {
  server?.close();
  await cleanup();
});

test("basic", async () => {
  const html = await request({ url: `http://localhost:${port}/basic.html` });
  expect(html).toMatchSnapshot();
});

test("minify", async () => {
  const html = await request({
    url: `http://localhost:${port}/basic.html`,
    minify: true
  });
  expect(html).toMatchSnapshot();
});

test("wait for selector", async () => {
  const html = await request({
    url: `http://localhost:${port}/wait-for-selector.html`,
    wait: "#bar"
  });
  expect(html).toMatchSnapshot();
});

test("manually", async () => {
  const html = await request({
    url: `http://localhost:${port}/manually.html`,
    manually: true
  });
  expect(html).toMatchSnapshot();
});

test("custom html selector", async () => {
  const html = await request({
    url: `http://localhost:${port}/html-selector.html`,
    htmlSelector: "#app"
  });
  expect(html).toMatchSnapshot();
});
