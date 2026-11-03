# @verifux/cli

Run a free [Verifux](https://verifux.app) snapshot from the terminal: UX, conversion and
**AI-agent readiness** for any URL. Zero dependencies, no local browser, no API key.

```bash
npx @verifux/cli https://example.com
```

```
  Verifux snapshot - example.com
  Mixed · 12 of 16 automated checks passed
  0 critical · 3 major · 2 minor

    MAJOR    No H1 heading on the page
    ...

  AI agent surface: none detected

  Full 54-checkpoint audit (UX, behaviour & AI-readiness): https://verifux.app
```

## CI gate

Fail a pipeline when the band drops too low:

```bash
npx @verifux/cli https://staging.example.com --ci --min-band mixed
```

Bands rank Poor < Weak < Mixed < Strong. `--ci` exits non-zero when the result is below
`--min-band` (default `weak`).

## Options

| Option | Description |
| --- | --- |
| `--ci` | Exit non-zero when the band is below `--min-band`. |
| `--min-band <band>` | Minimum band for `--ci`: poor, weak, mixed, strong. Default: weak. |
| `--json` | Print the raw snapshot JSON. |
| `--api-url <url>` | Backend to use (default `https://api.verifux.app`). |
| `-h, --help` · `-v, --version` | Help / version. |

This is the **free snapshot**, a fast deterministic read rather than the full 54-checkpoint audit
(which has no equivalent in the snapshot's check-count band). This repo is the client only; the
audit engine behind `api.verifux.app` is not open source.
