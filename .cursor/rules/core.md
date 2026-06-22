---
description: core/ must stay platform-agnostic
globs: core/**
---

`core/` is shared by every platform adapter. Don't import `cloudflare:*`,
`Deno.*`, or `node:*` here — pure functions and Web Standard APIs
(`fetch`, `URL`, `crypto`, `Date`) only. If a feature needs a platform API,
put it behind the `FeedRepository` port in `core/ports.ts` and implement it
in the relevant `platforms/*` adapter instead.
