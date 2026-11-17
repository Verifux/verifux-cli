# Verifux UX & AI-Readiness Audit — GitHub Action

Run a free [Verifux](https://verifux.app) snapshot on any URL inside CI. It checks UX,
conversion and **AI-agent readiness**, posts the result as a pull-request comment, and can
fail the build when the result drops below a band you choose.

No sign-up, no API key. The free snapshot is email-optional, so the Action needs nothing but
a URL. (A per-IP rate limit applies.)

## Usage

```yaml
name: UX audit
on: [pull_request]

jobs:
  verifux:
    runs-on: ubuntu-latest
    steps:
      - uses: Verifux/verifux-cli/action@action-v1
        with:
          url: https://your-site.example.com
          # Optional: fail the build if the band drops below this.
          # One of: none (default), poor, weak, mixed, strong.
          min-band: weak
```

The Action writes a summary to the job and, on a pull request, adds (or updates) a comment:

> ## 🟡 Verifux snapshot — your-site.example.com
> **Mixed** · 12 of 16 automated checks passed · 0 critical, 3 major, 2 minor
>
> | Severity | Finding |
> | --- | --- |
> | MAJOR | No H1 heading on the page |
> | … | … |
>
> **AI agent surface:** none detected

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `url` | — (required) | The URL to audit. |
| `min-band` | `none` | Fail the job when the band is below this: `none`, `poor`, `weak`, `mixed`, `strong`. Band order is Poor < Weak < Mixed < Strong. `none` never fails the build. |
| `comment` | `true` | Post/update a comment on the pull request. |
| `github-token` | `${{ github.token }}` | Token used to post the comment. |
| `api-url` | `https://api.verifux.app` | Only change this to target a staging backend. |
| `timeout-seconds` | `150` | How long to wait for the snapshot before failing. |

## Outputs

`band`, `checks-passed`, `checks-run`, `critical-count`, `major-count`, `minor-count`,
`result-url`. Use them in later steps:

```yaml
      - uses: Verifux/verifux-cli/action@action-v1
        id: audit
        with:
          url: https://your-site.example.com
      - run: echo "Band was ${{ steps.audit.outputs.band }}"
```

## What this is (and isn't)

This runs the **free snapshot** — a fast, deterministic read, not the full 54-checkpoint
audit. The snapshot has no score out of 100 on purpose; it reports a pass rate over a named
set of automated checks and a band. For the full UX / behavioural / AI-readiness audit with a
report and PDF, run it at [verifux.app](https://verifux.app).

Zero runtime dependencies: Node 20's built-in `fetch` and the GitHub REST API only.
