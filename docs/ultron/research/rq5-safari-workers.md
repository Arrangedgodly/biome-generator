# RQ5 — Safari Web Worker pitfalls

Affects: T5 (worker protocol), T10 (error surface) · Priority: P1 · Status: ✅ **committed 2026-08-26** (user approved recommended option)

## Question

What Safari-specific Web Worker pitfalls apply, and does any justify revisiting the approved error+retry-only failure mode (adding a main-thread fallback)?

## Constraints / evaluation criteria

Evergreen Safari (macOS + iOS) is a hard target. Approved: worker failure → friendly error + retry, NO automatic main-thread fallback in v1. Only concrete evidence of evergreen-Safari breakage can reopen that decision (and reopening = Ultron change control).

## Options considered

1. **No fallback; pin `worker.format: 'iife'`; add buffer-detach invariants** — ✅ recommended.
2. Main-thread fallback — rejected: no evidence of evergreen-Safari breakage; dual paths double testing surface and hide bugs.
3. `worker.format: 'es'` + build-target shuffling — rejected: gains nothing; iife strictly safer.
4. `?worker&inline` base64 workers — unnecessary unless single-file distribution emerges.

## Recommendation

**Keep error+retry; no fallback.** Module workers and ArrayBuffer transferables are universally supported in evergreen Safari: module workers since **Safari 15 (Sept 2021)** (current stable ~26.x), all evergreen for Chrome 80+/FF 114+. Pin `worker.format: 'iife'` in Vite config — already the default; pinning is zero-cost insurance (prod then needs only classic-worker support, baseline since 2015). Transferables work identically with classic workers — no protocol change.

**Protocol invariants for T5** (from real WebKit detach-timing evidence):
- Fresh output buffer allocated per request.
- Treat any transferred ArrayBuffer as dead the instant it is posted — never read/write views over it afterwards (guard with `byteLength === 0` detached-check where re-entry is possible). Detach timing has varied across engines (WebKit detaches synchronously; a 2026 Safari 18–26.5 case broke code that kept subarray views on a transferred buffer).
- `terminate()` the old worker before re-instantiating on retry; never reuse a terminated worker.

**T10 hardening (optional, cheap):** `worker.onerror`/`onmessageerror` → error + Retry (recreate worker, resend params); on `visibilitychange`→visible, optionally verify worker liveness (iOS can discard backgrounded pages).

## Evidence

- WebKit Safari 15 announcement — "adds support for ES6 Modules in Workers and ServiceWorkers" (2021-09). https://webkit.org/blog/11989/new-webkit-features-in-safari-15/
- caniuse `mdn-api_worker_worker_ecmascript_modules` — Safari 15–26.6 ✅, iOS Safari 15–26.6 ✅, no partials. https://caniuse.com/mdn-api_worker_worker_ecmascript_modules
- MDN `Worker()` compat (`options.type: "module"`: Safari 15+). https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker · mdn/browser-compat-data #17023 (landed 2021-03).
- MDN Transferable objects — ArrayBuffer transfer universal; historical Safari 11.1 MessagePort regression long fixed. https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
- positron #15560 (Safari 18–26.5) — synchronous detach broke subarray views; root cause = app violating transfer semantics; fix = copy before transfer. https://github.com/posit-dev/positron/issues/15560
- WebKit bugs 199866 / 211018 — iOS suspends JS in backgrounded tabs; 1–3s user-initiated foreground compute unaffected; page-discard mid-compute is what Retry covers.
- Vite worker options (`format` default iife). https://vite.dev/config/worker-options

## Tradeoffs / risks / confidence

**High** (caniuse + MDN BCD + WebKit release notes agree). Residual: ancient Safari (<15) gets the friendly error — acceptable; Vite dev mode serves native-ESM workers (fine on evergreen dev browsers); the detach rule only bites if T5 reuses posted buffers — prohibited above.

## Implementation consequences

- **T5:** transferable Float32Arrays unchanged; add the three invariants; classic/iife format confirmed compatible.
- **T10:** error + retry surface as approved; optional liveness check on visibility change; pin `worker.format: 'iife'`.
