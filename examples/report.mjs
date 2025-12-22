import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const OUTROOT = '.demo-out';

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function latestRunDir() {
  const runsDir = join(OUTROOT, 'runs');
  if (!existsSync(runsDir)) throw new Error(`No runs found at: ${runsDir}`);
  const dirs = readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(runsDir, d.name));

  if (!dirs.length) throw new Error(`No runs found at: ${runsDir}`);

  dirs.sort((a, b) => {
    const sa = a.toLowerCase();
    const sb = b.toLowerCase();
    return sb.localeCompare(sa);
  });
  return dirs[0];
}

function safeJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function main() {
  const runDir = latestRunDir();
  const runJson = safeJson(join(runDir, 'run.json')) ?? {};

  const casesDir = join(runDir, 'cases');
  const caseNames = existsSync(casesDir)
    ? readdirSync(casesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];

  const rows = [];

  for (const name of caseNames) {
    const caseDir = join(casesDir, name);
    const manifestPath = join(caseDir, 'manifest.json');
    const manifest = safeJson(manifestPath);

    // fallback: infer page.html existence
    const pageRel = toPosix(join('cases', name, 'html', 'page.html'));
    const smokeRel = toPosix(join('cases', name, 'offline', 'smoke.html'));
    const hasPage = existsSync(join(runDir, pageRel));
    const hasSmoke = existsSync(join(runDir, smokeRel));

    const ms = manifest?.durationMs ?? null;
    const htmlBytes = manifest?.htmlBytes ?? null;
    const captured = manifest?.responses?.length ?? 0;
    const failed = manifest?.failed?.length ?? 0;
    const errCount = manifest?.errors?.length ?? 0;

    const status = manifest
      ? errCount > 0
        ? 'failed'
        : 'ok'
      : hasPage
      ? 'partial'
      : 'missing';

    rows.push({
      name,
      pageRel: hasPage ? pageRel : null,
      smokeRel: hasSmoke ? smokeRel : null,
      ms,
      htmlBytes,
      captured,
      failed,
      errCount,
      status,
    });
  }

  // Sort stable
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const report = {
    runDir: toPosix(runDir),
    target: runJson.target ?? null,
    startedAt: runJson.startedAt ?? null,
    cases: rows,
    generatedAt: new Date().toISOString(),
  };

  const reportJsonPath = join(runDir, 'report.json');
  writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), 'utf8');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Run report</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; }
    code { background: #f3f3f3; padding: 2px 6px; border-radius: 6px; }
    table { border-collapse: collapse; width: 100%; margin-top: 16px; }
    th, td { border: 1px solid #ddd; padding: 8px; font-size: 14px; vertical-align: top; }
    th { background: #fafafa; text-align: left; }
    tr.failed { background: #fff3f3; }
    tr.partial { background: #fffdf0; }
    .muted { color: #666; }
  </style>
</head>
<body>
  <h1>Run report</h1>

  <p><code>${escapeHtml(toPosix(runDir))}</code></p>
  <p>Target: <code>${escapeHtml(report.target ?? '')}</code></p>

  <table>
    <thead>
      <tr>
        <th>case</th>
        <th>page</th>
        <th>smoke</th>
        <th>ms</th>
        <th>html bytes</th>
        <th>captured</th>
        <th>failed</th>
        <th>errors</th>
        <th>status</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map((r) => {
          const cls =
            r.status === 'failed'
              ? 'failed'
              : r.status === 'partial'
              ? 'partial'
              : '';
          const pageLink = r.pageRel
            ? `<a href="./${escapeHtml(r.pageRel)}">page</a>`
            : `<span class="muted">n/a</span>`;
          const smokeLink = r.smokeRel
            ? `<a href="./${escapeHtml(r.smokeRel)}">smoke</a>`
            : `<span class="muted">n/a</span>`;
          return `<tr class="${cls}">
            <td><code>${escapeHtml(r.name)}</code></td>
            <td>${pageLink}</td>
            <td>${smokeLink}</td>
            <td>${r.ms ?? ''}</td>
            <td>${r.htmlBytes ?? ''}</td>
            <td>${r.captured ?? 0}</td>
            <td>${r.failed ?? 0}</td>
            <td>${r.errCount ?? 0}</td>
            <td>${escapeHtml(r.status)}</td>
          </tr>`;
        })
        .join('\n')}
    </tbody>
  </table>

  <h2>Notes</h2>
  <ul>
    <li><code>page</code> links open the raw snapshot.</li>
    <li><code>smoke</code> links open the locally-rewritten + inlined version for quick browser verification.</li>
    <li>Failed cases still show up here (so you always have a record of what happened).</li>
  </ul>

</body>
</html>`;

  const reportHtmlPath = join(runDir, 'report.html');
  writeFileSync(reportHtmlPath, html, 'utf8');

  console.log(`\nRun: ${toPosix(runDir)}`);
  console.log(`Target: ${report.target ?? ''}\n`);
  console.log(
    `case                         ms       html       cap  fail  err  status`
  );
  for (const r of rows) {
    const ms = String(r.ms ?? '').padEnd(8);
    const hb = String(r.htmlBytes ?? '').padEnd(9);
    const cap = String(r.captured ?? 0).padEnd(4);
    const fail = String(r.failed ?? 0).padEnd(5);
    const err = String(r.errCount ?? 0).padEnd(4);
    console.log(
      `${r.name.padEnd(28)} ${ms} ${hb} ${cap} ${fail} ${err} ${r.status}`
    );
  }

  console.log(`\nWrote: ${toPosix(reportJsonPath)}`);
  console.log(`Wrote: ${toPosix(reportHtmlPath)}\n`);
}

main();
