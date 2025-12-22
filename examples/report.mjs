import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const OUTROOT = '.demo-out';
const RUNS_DIR = join(OUTROOT, 'runs');
const args = process.argv.slice(2);
function arg(name, fallback) {
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
}
function listDirs(p) {
  if (!existsSync(p)) return [];
  return readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}
function latestRunDir() {
  const runs = listDirs(RUNS_DIR).sort().reverse();
  if (runs.length === 0) throw new Error('No runs found under .demo-out/runs');
  return join(RUNS_DIR, runs[0]);
}
function readJSON(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}
function safeNum(n) {
  return typeof n === 'number' ? n : 0;
}
function classifyFilePath(file) {
  if (!file) return 'other';
  if (file.includes('/assets/js-min/')) return 'js-min';
  if (file.includes('/assets/js-chunks/')) return 'js-chunks';
  if (file.includes('/assets/js/')) return 'js';
  if (file.includes('/assets/css/')) return 'css';
  if (file.includes('/assets/img/')) return 'img';
  if (file.includes('/assets/font/')) return 'font';
  if (file.includes('/assets/json/')) return 'json';
  if (file.includes('/cdn/')) return 'cdn';
  return 'other';
}
function summarizeCase(caseDirName, manifest) {
  const responses = Array.isArray(manifest.responses) ? manifest.responses : [];
  const counts = {};
  for (const r of responses) {
    const k = classifyFilePath(r.file || '');
    counts[k] = (counts[k] || 0) + 1;
  }
  const smokeInline = manifest?.smoke?.inline
    ? join(runDir, manifest.smoke.inline)
    : null;
  return {
    name: caseDirName,
    url: manifest.url,
    durationMs: safeNum(manifest.durationMs),
    htmlBytes: safeNum(manifest.htmlBytes),
    capture: !!manifest.capture,
    captured: responses.length,
    failed: Array.isArray(manifest.failed) ? manifest.failed.length : 0,
    errors: Array.isArray(manifest.errors) ? manifest.errors.length : 0,
    counts,
    pageHtml: join('cases', caseDirName, 'html', 'page.html'),
    smokeInline:
      smokeInline && existsSync(smokeInline) ? manifest.smoke.inline : null,
  };
}
const runArg = arg('--run', '');
const runDir = runArg ? runArg : latestRunDir();
const casesDir = join(runDir, 'cases');
const caseDirs = listDirs(casesDir).sort();
const summary = {
  runDir,
  runJson: null,
  cases: [],
};
const runJsonPath = join(runDir, 'run.json');
if (existsSync(runJsonPath)) summary.runJson = readJSON(runJsonPath);
for (const c of caseDirs) {
  const manifestPath = join(casesDir, c, 'manifest.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = readJSON(manifestPath);
  summary.cases.push(summarizeCase(c, manifest));
}
console.log(`\nRun: ${runDir}`);
if (summary.runJson?.target) console.log(`Target: ${summary.runJson.target}`);
console.log('');
const rows = summary.cases.map((c) => ({
  case: c.name,
  ms: c.durationMs,
  html: c.htmlBytes,
  cap: c.capture ? 'Y' : '',
  res: c.captured,
  fail: c.failed,
  err: c.errors,
}));
const pad = (s, n) => String(s).padEnd(n);
console.log(
  `${pad('case', 28)} ${pad('ms', 8)} ${pad('html', 10)} ${pad('cap', 4)} ${pad(
    'res',
    6
  )} ${pad('fail', 6)} ${pad('err', 5)}`
);
for (const r of rows) {
  console.log(
    `${pad(r.case, 28)} ${pad(r.ms, 8)} ${pad(r.html, 10)} ${pad(
      r.cap,
      4
    )} ${pad(r.res, 6)} ${pad(r.fail, 6)} ${pad(r.err, 5)}`
  );
}
writeFileSync(
  join(runDir, 'report.json'),
  JSON.stringify(summary, null, 2),
  'utf8'
);
const htmlRows = summary.cases
  .map((c) => {
    const counts = Object.entries(c.counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    const smokeLink = c.smokeInline
      ? `<a href="${c.smokeInline}">smoke</a>`
      : '';
    return `<tr>
      <td>${c.name}</td>
      <td><a href="${c.pageHtml}">page</a></td>
      <td>${smokeLink}</td>
      <td>${c.durationMs}</td>
      <td>${c.htmlBytes}</td>
      <td>${c.capture ? c.captured : ''}</td>
      <td>${counts}</td>
    </tr>`;
  })
  .join('\n');
const smokeRoot = join(runDir, 'smoke.html');
const smokeRootLink = existsSync(smokeRoot)
  ? `<p><a href="smoke.html">Open smoke.html</a></p>`
  : '';
const reportHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>fuego-firefox report</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; padding: 16px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; vertical-align: top; }
    th { background: #f6f6f6; text-align: left; }
    code { background: #f2f2f2; padding: 2px 6px; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>Run report</h1>
  <p><code>${runDir}</code></p>
  ${
    summary.runJson?.target
      ? `<p>Target: <code>${summary.runJson.target}</code></p>`
      : ''
  }
  ${smokeRootLink}
  <table>
    <thead>
      <tr>
        <th>case</th>
        <th>page</th>
        <th>smoke</th>
        <th>ms</th>
        <th>html bytes</th>
        <th>captured</th>
        <th>breakdown</th>
      </tr>
    </thead>
    <tbody>
      ${htmlRows}
    </tbody>
  </table>
  <h2>Notes</h2>
  <ul>
    <li><code>page</code> links open the raw snapshot.</li>
    <li><code>smoke</code> links (when present) open the locally-rewritten + inlined version for quick browser verification.</li>
  </ul>
</body>
</html>`;
writeFileSync(join(runDir, 'report.html'), reportHtml, 'utf8');
console.log(`\nWrote: ${join(runDir, 'report.json')}`);
console.log(`Wrote: ${join(runDir, 'report.html')}`);
if (existsSync(smokeRoot)) console.log(`Wrote: ${smokeRoot}`);
console.log('');
