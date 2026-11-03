#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
//  @verifux/cli - run a free Verifux snapshot from the terminal.
//
//  Zero dependencies, no local browser, no API key. It calls the hosted
//  Verifux API (the snapshot is email-optional), so install is just `npx`.
//  A `--ci` mode fails the build when the band drops below a minimum, so it
//  drops into a pipeline the same way the GitHub Action does.
//
//  This repo is the client only. The audit engine behind api.verifux.app is
//  not open source. Node 20+ (global fetch).
// ─────────────────────────────────────────────────────────────────────
'use strict';

// Read the version from package.json so --version can never drift from the
// published package: it printed 1.0.0 while npm was on 1.0.2, visible to anyone
// who ran `npx @verifux/cli --version`. (Same fix as the MCP server, 2026-10-29.)
const VERSION = require('./package.json').version;
const BAND_ORDER = { poor: 0, weak: 1, mixed: 2, strong: 3 };

function parseArgs(argv) {
  const o = { url: null, json: false, ci: false, minBand: 'weak', apiUrl: null, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--json') o.json = true;
    else if (a === '--ci') o.ci = true;
    else if (a === '--min-band') o.minBand = (argv[++i] || 'weak').toLowerCase();
    else if (a.startsWith('--min-band=')) o.minBand = a.slice(11).toLowerCase();
    else if (a === '--api-url') o.apiUrl = argv[++i];
    else if (a.startsWith('--api-url=')) o.apiUrl = a.slice(10);
    else if (!a.startsWith('-') && !o.url) o.url = a;
  }
  return o;
}

const HELP = `verifux - free Verifux UX & AI-readiness snapshot

Usage:
  npx @verifux/cli <url> [options]

Options:
  --ci                 Exit non-zero when the band is below --min-band (for pipelines).
  --min-band <band>    Minimum acceptable band for --ci: poor, weak, mixed, strong. Default: weak.
  --json               Print the raw snapshot JSON instead of a report.
  --api-url <url>      Backend to use. Default: https://api.verifux.app
  -h, --help           Show this help.
  -v, --version        Show the version.

Examples:
  npx @verifux/cli https://example.com
  npx @verifux/cli https://example.com --ci --min-band mixed
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Identifies this client to the API so a CLI run is distinguishable from a web
// or MCP run in the dashboard (Verifux usage tagging). The server maps the
// `verifux-cli/` prefix to source 'cli'; an older client that predates this
// just reads as 'unknown' rather than breaking.
const UA = `verifux-cli/${VERSION}`;

async function runSnapshot(apiBase, url) {
  const start = await fetch(`${apiBase}/api/snapshot`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ url }),
  });
  const startJson = await start.json().catch(() => ({}));
  if (!start.ok || !startJson.jobId) {
    throw new Error(`Could not start snapshot (HTTP ${start.status}): ${startJson.message || 'no jobId returned'}`);
  }
  const jobId = startJson.jobId;
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    await sleep(2500);
    let j = {};
    try { j = await (await fetch(`${apiBase}/api/snapshot/${jobId}/status`, { headers: { 'User-Agent': UA } })).json(); } catch { continue; }
    if (j.status === 'error') throw new Error(`Snapshot could not complete: ${j.message || j.code || 'unknown error'}`);
    if (j.status === 'done') return j.snapshot;
  }
  throw new Error('Snapshot timed out.');
}

// Does the snapshot say the page declares an agent surface? Prefer the API's
// clean boolean; fall back to reading the agent_surface array of display rows
// (which is what the field actually is - an earlier version read .declared on
// the array and so always printed "none detected"). A declaration counts when
// a tool/mcp.json/agents.md/WebMCP row has a positive value.
function agentSurfaceDeclared(snap) {
  if (typeof snap.agent_surface_declared === 'boolean') return snap.agent_surface_declared;
  const as = snap.agent_surface;
  if (Array.isArray(as)) {
    return as.some((r) => r && ['agent_tools', 'agent_mcp_json', 'agent_agents_md', 'agent_webmcp'].includes(r.id) && (r.value || 0) > 0);
  }
  return !!(as && (as.has_surface || as.declared || as.found));
}

function report(snap) {
  const mc = snap.machine_check || {};
  const band = mc.band || 'unknown';
  const lines = [];
  lines.push('');
  lines.push(`  Verifux snapshot - ${snap.hostname || snap.url || 'the page'}`);
  lines.push(`  ${band} · ${mc.checks_passed ?? 0} of ${mc.checks_run ?? 0} automated checks passed`);
  lines.push(`  ${snap.critical_count ?? 0} critical · ${snap.major_count ?? 0} major · ${snap.minor_count ?? 0} minor`);
  const findings = Array.isArray(snap.findings) ? snap.findings.slice(0, 5) : [];
  if (findings.length) {
    lines.push('');
    for (const f of findings) {
      const sev = (f.severity || '').toString().toUpperCase().padEnd(8);
      lines.push(`    ${sev} ${(f.headline || f.detail || '').toString()}`);
    }
  }
  const as = snap.agent_surface;
  if (as) {
    lines.push('');
    lines.push(`  AI agent surface: ${agentSurfaceDeclared(snap) ? 'declared' : 'none detected'}`);
  }
  lines.push('');
  lines.push('  Full 54-checkpoint audit (UX, behaviour & AI-readiness): https://verifux.app');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { process.stdout.write(HELP); return; }
  if (o.version) { process.stdout.write(VERSION + '\n'); return; }
  if (!o.url) { process.stderr.write('Error: a <url> is required.\n\n' + HELP); process.exit(2); }

  const apiBase = (o.apiUrl || process.env.VERIFUX_API_URL || 'https://api.verifux.app').replace(/\/+$/, '');

  let snap;
  try {
    snap = await runSnapshot(apiBase, o.url);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }

  if (o.json) { process.stdout.write(JSON.stringify(snap, null, 2) + '\n'); }
  else { process.stdout.write(report(snap)); }

  if (o.ci) {
    const band = (snap.machine_check?.band || 'unknown').toLowerCase();
    if (BAND_ORDER[band] !== undefined && BAND_ORDER[o.minBand] !== undefined && BAND_ORDER[band] < BAND_ORDER[o.minBand]) {
      process.stderr.write(`\nCI gate: band "${snap.machine_check.band}" is below the required minimum "${o.minBand}".\n`);
      process.exit(1);
    }
  }
}

// Exported for tests; runs as a CLI only when invoked directly.
module.exports = { parseArgs, report, runSnapshot, agentSurfaceDeclared };
if (require.main === module) main().catch((e) => { process.stderr.write(`Error: ${e.message}\n`); process.exit(1); });
