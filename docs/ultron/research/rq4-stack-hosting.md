# RQ4 — Stack verification and hosting

Affects: T1 (scaffold), T18 (deploy) · Priority: P0 · Status: ✅ **committed 2026-08-26** (user approved recommended option)

## Question

Does TypeScript + Vite + vanilla DOM give clean Web Worker bundling? Which static host for a no-backend, hash-routed site?

## Constraints / evaluation criteria

No backend; no framework (portfolio story: "understands the platform"); module workers + transferable ArrayBuffers must bundle cleanly in dev and prod; free hosting; macOS dev on GitHub.

## Options considered

1. **TypeScript + Vite (vanilla-ts) + GitHub Pages via Actions** — ✅ recommended.
2. **Netlify** — lowest manual-deploy friction (drag-drop `dist/`, CLI); drop limits (<50MB deploys); Git CI needs connection anyway. Good second choice.
3. **Vercel** — genuinely zero-config Vite detection, but its Vite docs center on SPA rewrites/Functions — irrelevant complexity here.
4. **tsc + esbuild** — strictly worse: hand-roll worker chunking, dev serving, HMR that Vite gives built-in.

## Recommendation

**Stack CONFIRMED: TypeScript + Vite + vanilla DOM/canvas. Host: GitHub Pages via GitHub Actions.**

Setup outline:
- `npm create vite@latest -- --template vanilla-ts` (Vite 8.2.x current; requires Node 20.19+/22.12+).
- Worker pattern: `new Worker(new URL('./map.worker.ts', import.meta.url), { type: 'module' })` — Vite's recommended form; detection works **only** when `new URL()` is directly inside `new Worker()` with static options. Alternative: `import MapWorker from './map.worker?worker?&inline'`-style constructor (typed via `vite/client`).
- `vite.config.ts`: `base: '/<repo>/'` for project pages from day one; `worker.format` default `'iife'` (classic worker, max prod compat — pinned per D5).
- Deploy: repo Settings → Pages → Source: **GitHub Actions**; workflow = checkout → setup-node (lts, npm cache) → `npm ci` → `npm run build` → configure-pages → upload-pages-artifact (`dist`) → deploy-pages; permissions `contents: read`, `pages: write`, `id-token: write`.
- Transfer protocol: `postMessage(data, [buffer])` both directions; receiver re-wraps `new Float32Array(buf)`; origin view detaches (see D5 invariants).
- Hash routing ⇒ no 404/SPA-rewrite handling needed at all.

## Evidence

- Vite 8.2.2 release (2026-08-20); Vite 8 = Rolldown bundler. https://github.com/vitejs/vite/releases · https://vite.dev/blog/announcing-vite8
- Vite features — Web Workers: `new URL`-in-`new Worker` is "the recommended way"; detection constraints; dev relies on native ESM workers, prod compiles to separate chunk. https://vite.dev/guide/features
- Vite worker options — `worker.format: 'es' | 'iife'`, **default `'iife'`**; `worker.plugins` factory rule. https://vite.dev/config/worker-options
- Vite static-deploy guide — `base: '/<REPO>/'` for project pages; Netlify/Vercel commands. https://vite.dev/guide/static-deploy
- vite/client.d.ts — `*?worker` typing works under strict TS via `/// <reference types="vite/client" />`. https://github.com/vitejs/vite/blob/main/packages/vite/client.d.ts
- MDN Transferable objects — ArrayBuffer transferable, typed arrays NOT (transfer `.buffer`); detach semantics. https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
- GitHub Pages publishing-source docs — Actions source for non-Jekyll builds; site public even if repo private. https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## Tradeoffs / risks / confidence

**High** (all primary-source). Notes: dev-mode module workers need Safari 15+/FF 114+ (dev machine only; prod is iife). Workers don't participate in HMR — expect reload on worker edits. The `new URL(...)` inline-formula gotcha silently degrades to a static asset if written otherwise. Vite 8/Rolldown is fresh but worker features are long-stable. GH Pages needs one toggle (Actions as source).

## Implementation consequences

- **T1:** vanilla-ts template, strict TS as-is, keep `vite-env.d.ts`, set `base` from day one, worker as plain TS with ESM imports.
- **T18:** deploy.yml per outline; no SPA fallback needed.
