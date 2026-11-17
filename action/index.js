#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
//  Verifux GitHub Action - runs the FREE Verifux snapshot on a URL in CI,
//  writes a job summary, optionally comments on the PR, and optionally fails
//  the build when the result band is below a threshold.
//
//  Zero dependencies on purpose: Node 20 ships global fetch, and the PR
//  comment uses the REST API directly with the workflow token. Nothing to
//  bundle, nothing to audit. The snapshot is email-optional (VX-96), so this
//  needs no auth and no API key - the per-IP rate limit is the only gate.
// ─────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');

const BAND_ORDER = { poor: 0, weak: 1, mixed: 2, strong: 3 };
const MARKER = '<!-- verifux-audit -->';

function getInput(name, def = '') {
  const v = process.env['INPUT_' + name.toUpperCase().replace(/ /g, '_')];
  return v === undefined || v === '' ? def : String(v).trim();
}
function setOutput(name, value) {
  const f = process.env.GITHUB_OUTPUT;
  if (f) fs.appendFileSync(f, `${name}=${String(value).replace(/\n/g, ' ')}\n`);
}
function writeSummary(md) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) { try { fs.appendFileSync(f, md + '\n'); } catch { /* summary is best-effort */ } }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fail(msg) { console.error(`::error::${msg}`); process.exit(1); }

const BAND_EMOJI = { Strong: '🟢', Mixed: '🟡', Weak: '🟠', Poor: '🔴', unknown: '⚪' };

// Prefer the API's clean boolean; fall back to reading the agent_surface array
// of rows (an earlier version read .declared on the array and always printed
// "none detected"). Declared when a tool/mcp.json/agents.md/WebMCP row is > 0.
function agentSurfaceDeclared(snap) {
  if (typeof snap.agent_surface_declared === 'boolean') return snap.agent_surface_declared;
  const as = snap.agent_surface;
  if (Array.isArray(as)) {
    return as.some((r) => r && ['agent_tools', 'agent_mcp_json', 'agent_agents_md', 'agent_webmcp'].includes(r.id) && (r.value || 0) > 0);
  }
  return !!(as && (as.has_surface || as.declared || as.found));
}

function renderMarkdown(snap) {
  const mc = snap.machine_check || {};
  const band = mc.band || 'unknown';
  const host = snap.hostname || snap.url || 'the page';
  const run = mc.checks_run ?? 0;
  const passed = mc.checks_passed ?? 0;
  const crit = snap.critical_count ?? 0;
  const major = snap.major_count ?? 0;
  const minor = snap.minor_count ?? 0;

  const lines = [];
  lines.push(MARKER);
  lines.push(`## ${BAND_EMOJI[band] || '⚪'} Verifux snapshot — ${host}`);
  lines.push('');
  lines.push(`**${band}** · ${passed} of ${run} automated checks passed · ${crit} critical, ${major} major, ${minor} minor`);
  lines.push('');

  const findings = Array.isArray(snap.findings) ? snap.findings.slice(0, 5) : [];
  if (findings.length) {
    lines.push('| Severity | Finding |');
    lines.push('| --- | --- |');
    for (const f of findings) {
      const sev = (f.severity || '').toString().toUpperCase() || '—';
      const head = (f.headline || f.detail || '').toString().replace(/\|/g, '\\|').slice(0, 160);
      lines.push(`| ${sev} | ${head} |`);
    }
    lines.push('');
  } else {
    lines.push('_No blocking findings surfaced in the free snapshot._');
    lines.push('');
  }

  // Agent-readiness is our differentiator - surface the declared surface if any.
  const as = snap.agent_surface;
  if (as) {
    lines.push(`**AI agent surface:** ${agentSurfaceDeclared(snap) ? 'declared' : 'none detected'}`);
    lines.push('');
  }

  lines.push(`This is the free snapshot. Run the full 54-checkpoint audit (UX, behaviour and AI-readiness) at [verifux.app](https://verifux.app).`);
  return lines.join('\n');
}

// Identifies this client to the Verifux API so a CI run is distinguishable
// from a web / CLI / MCP run in the dashboard (Sally's usage ask). The server
// maps the `verifux-action` prefix to source 'action'. Read from package.json
// so it never drifts from the published action version.
let ACTION_VERSION = '0.0.0';
try { ACTION_VERSION = require('./package.json').version || ACTION_VERSION; } catch { /* keep default */ }
const UA = `verifux-action/${ACTION_VERSION}`;

async function postJson(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body) });
}

async function upsertPrComment(token, markdown) {
  const repo = process.env.GITHUB_REPOSITORY; // owner/name
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!repo || !eventPath) return; // not enough context
  let event = {};
  try { event = JSON.parse(fs.readFileSync(eventPath, 'utf8')); } catch { return; }
  const prNumber = event.pull_request?.number || event.issue?.number;
  if (!prNumber) { console.log('Not a pull request event - skipping comment.'); return; }

  const api = process.env.GITHUB_API_URL || 'https://api.github.com';
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'verifux-action',
  };
  try {
    // Find an existing Verifux comment to update, so repeated runs don't pile up.
    const listRes = await fetch(`${api}/repos/${repo}/issues/${prNumber}/comments?per_page=100`, { headers });
    const comments = listRes.ok ? await listRes.json() : [];
    const existing = Array.isArray(comments) ? comments.find(c => (c.body || '').includes(MARKER)) : null;
    if (existing) {
      await fetch(`${api}/repos/${repo}/issues/comments/${existing.id}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: markdown }),
      });
    } else {
      await fetch(`${api}/repos/${repo}/issues/${prNumber}/comments`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: markdown }),
      });
    }
  } catch (err) {
    console.log(`Could not post PR comment (non-fatal): ${err.message}`);
  }
}

async function main() {
  const url = getInput('url');
  if (!url) fail('`url` input is required.');
  const api = getInput('api-url', 'https://api.verifux.app').replace(/\/+$/, '');
  const minBand = getInput('min-band', 'none').toLowerCase();
  const doComment = getInput('comment', 'true') !== 'false';
  const token = getInput('github-token', process.env.GITHUB_TOKEN || '');
  const timeoutS = parseInt(getInput('timeout-seconds', '150'), 10) || 150;

  console.log(`Running Verifux snapshot for ${url} via ${api} ...`);

  let startJson;
  try {
    const start = await postJson(`${api}/api/snapshot`, { url });
    startJson = await start.json().catch(() => ({}));
    if (!start.ok || !startJson.jobId) {
      fail(`Could not start snapshot (HTTP ${start.status}): ${startJson.message || 'no jobId returned'}`);
    }
  } catch (err) {
    fail(`Could not reach the Verifux API: ${err.message}`);
  }

  const jobId = startJson.jobId;
  const deadline = Date.now() + timeoutS * 1000;
  let snap = null;
  while (Date.now() < deadline) {
    await sleep(2500);
    let j = {};
    try {
      const r = await fetch(`${api}/api/snapshot/${jobId}/status`, { headers: { 'User-Agent': UA } });
      j = await r.json().catch(() => ({}));
    } catch { continue; }
    if (j.status === 'error') fail(`Snapshot could not complete: ${j.message || j.code || 'unknown error'}`);
    if (j.status === 'done') { snap = j.snapshot; break; }
  }
  if (!snap) fail(`Snapshot timed out after ${timeoutS}s.`);

  const mc = snap.machine_check || {};
  const band = mc.band || 'unknown';
  setOutput('band', band);
  setOutput('checks-passed', mc.checks_passed ?? 0);
  setOutput('checks-run', mc.checks_run ?? 0);
  setOutput('critical-count', snap.critical_count ?? 0);
  setOutput('major-count', snap.major_count ?? 0);
  setOutput('minor-count', snap.minor_count ?? 0);
  setOutput('result-url', 'https://verifux.app');

  const markdown = renderMarkdown(snap);
  writeSummary(markdown);
  console.log(`Result: ${band} (${mc.checks_passed ?? 0}/${mc.checks_run ?? 0} checks passed).`);

  if (doComment && token) await upsertPrComment(token, markdown);

  // Gate: fail only when a real minimum is set AND the band is below it.
  if (minBand !== 'none' && BAND_ORDER[band.toLowerCase()] !== undefined) {
    if (BAND_ORDER[minBand] === undefined) {
      console.log(`Unknown min-band "${minBand}" - not gating.`);
    } else if (BAND_ORDER[band.toLowerCase()] < BAND_ORDER[minBand]) {
      fail(`Verifux band "${band}" is below the required minimum "${minBand}".`);
    }
  }
}

main().catch(err => fail(err.stack || err.message || String(err)));
