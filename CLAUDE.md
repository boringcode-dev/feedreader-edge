@AGENTS.md

## Claude-specific notes

- `core/` must stay free of `cloudflare:*`/`Deno.*`/`node:*` imports —
  verify before adding a new `core/` dependency.
- Any change to `core/render.ts` needs the SSR diff check in
  [docs/RUNBOOK.md](docs/RUNBOOK.md) before being considered done.
