<div align="center">

# `npx @verifux/cli`

### Can an AI agent actually use your website?

Agent readiness is the only part of a site that can break without anyone finding out.
No error, no alert, nothing in a dashboard. Just traffic that never arrives.
**This tells you in about thirty seconds.**

[![npm](https://img.shields.io/npm/v/@verifux/cli?color=FF0033&label=npm&logo=npm&logoColor=white)](https://www.npmjs.com/package/@verifux/cli)
[![downloads](https://img.shields.io/npm/dm/@verifux/cli?color=FF0033&label=downloads)](https://www.npmjs.com/package/@verifux/cli)
[![node](https://img.shields.io/node/v/@verifux/cli?color=111827&label=node)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@verifux/cli?color=111827)](./LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-111827)](./package.json)
[![MCP](https://img.shields.io/badge/also_an-MCP_server-7C3AED)](https://github.com/Verifux/verifux-mcp)

</div>

---

## Try it right now

No install, no signup, no API key.

```bash
npx @verifux/cli https://example.com
```

A real run, not a mock-up:

```console
$ npx @verifux/cli https://example.com

  Verifux snapshot - example.com
  Mixed · 13 of 16 automated checks passed
  0 critical · 2 major · 1 minor

    MAJOR    No Organization or FAQPage structured data for AI answer engines
    MAJOR    No H1 heading on the page
    MINOR    No meta description for search engines or AI summaries to quote

  AI agent surface: none detected

  Full 54-checkpoint audit (UX, behaviour & AI-readiness): https://verifux.app
```

That last line is the one most people have never checked. **`AI agent surface: none detected`**
means nothing an agent looks for was found: no declared tools, no `/.well-known/mcp.json`,
no `/agents.md`.

> We got that result on our own site. The file existed, we were serving it at the wrong path, and
> nothing anywhere warned us. One path, and the whole surface was invisible.

---

## Fail the build instead of finding out later

The reason this is a CLI and not a web form. Agent readiness breaks on a deploy that had nothing to
do with it, so gate it like anything else that matters.

```bash
npx @verifux/cli https://staging.example.com --ci --min-band mixed
```

`--ci` exits non-zero when the band lands below `--min-band`. Bands rank
**Poor → Weak → Mixed → Strong**.

```yaml
# .github/workflows/agent-readiness.yml
name: Agent readiness
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx -y @verifux/cli https://your-site.com --ci --min-band mixed
```

---

## What it looks at

| | |
| --- | --- |
| 🤖 **Agent surface** | Declared tools, `/.well-known/mcp.json`, `/agents.md`, WebMCP |
| 🔎 **Answer-engine readiness** | Structured data, headings, metadata an AI can quote |
| ♿ **Accessibility** | The unlabelled controls that break screen readers and agents alike |
| ⚡ **Performance** | Real measured paint and layout-shift figures |
| 🎯 **Conversion** | Whether the page makes the next step obvious |

---

## Options

| Option | What it does |
| --- | --- |
| `--ci` | Exit non-zero when the band is below `--min-band` |
| `--min-band <band>` | `poor` · `weak` · `mixed` · `strong`. Default `weak` |
| `--json` | Print the raw snapshot JSON instead of the report |
| `--api-url <url>` | Point at a different backend. Default `https://api.verifux.app` |
| `-h, --help` | Show help |
| `-v, --version` | Show the version |

---

## Prefer it inside your editor?

The same check as an MCP server, so your coding agent can run it mid-session:

```bash
claude mcp add verifux -- npx -y @verifux/mcp
```

→ **[Verifux/verifux-mcp](https://github.com/Verifux/verifux-mcp)** · listed in the
[official MCP registry](https://registry.modelcontextprotocol.io/?q=verifux)

---

<div align="center">

**This is the free snapshot:** a fast, deterministic read. It has no score out of 100 on purpose,
because that belongs to the full 54-checkpoint audit at **[verifux.app](https://verifux.app)**.

This repo is the client. The audit engine behind `api.verifux.app` is not open source.

<sub>MIT · built by <a href="https://verifux.app">Verifux</a></sub>

</div>
