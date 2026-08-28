# T17 — Human Test Runbook

You (the coordinator) run this yourself, with two real people and two real devices.
Total time: about 30 minutes (5 min setup · 10–15 min Section A · 10 min Section B).
No technical knowledge needed by anyone except you, only for the startup commands.

What you're testing, in one sentence each:

- **Section A** — after watching the map generate ONCE, can two people describe what
  they saw, unprompted, in terms of height, water, and biome colors?
- **Section B** — four quick checks on real phones (a real Safari and a mid-range
  Android) that automated testing physically could not reach.

Record everything in the template at `docs/ultron/evidence/t17/t17-results.md`
(already created — just open it and fill it in as you go).

---

## Before you start (5 min)

Start the app from the project folder:

```
npm run build
npm run preview -- --host
```

This serves the exact production build. Vite prints a **Local** URL and a
**Network** URL (e.g. `http://192.168.1.42:4173/biome-generator/`).

- On your computer: open the **Local** URL.
- On phones (same Wi-Fi as the computer): type the **Network** URL exactly as
  printed, including the `/biome-generator/` part at the end.

Why `--host`: without it Vite only accepts connections from the computer itself,
so phones on the same Wi-Fi can't load the page. If `preview` gives you trouble,
`npm run dev -- --host` works too (dev version, same behavior for this test).

Sanity check on your computer first: the page loads and a map generates by
itself over ~3 seconds (grayscale → water-toned → full color). The controls you
should see: sliders **Elevation** and **Moisture**, a **Seed** box with a 🎲
button, **Generate** / **Skip**, presets **Archipelago** / **Continent** /
**Highlands**, **Export** / **Share**.

---

## Section A — two-person comprehension test (10–15 min)

**The bar (from the plan):** each person watches ONE generation, then describes
the three stages unprompted. A person **passes** when their own words cover all
three of these ideas:

| # | Concept family | Counts if they say things like… |
|---|---|---|
| 1 | Height / elevation | height, elevation, mountains, altitude, terrain rising, "a height map" |
| 2 | Water / moisture | water, moisture, rain, wet/dry, humidity, rivers, "how wet areas are" |
| 3 | Biomes / colors | biomes, colors meaning environment, desert/forest/snow/jungle zones, climate, vegetation |

**T17 passes only if BOTH people pass.** Watching the map is ~3 seconds; the
whole conversation is 5–7 minutes per person.

### Ground rules (this is what keeps the evidence honest)

1. Run each person **separately** — the second person must not hear the first.
2. Say only the script below. **Do not say the words** elevation, height,
   moisture, water, wet, biome, climate, desert, forest, terrain — until after
   you've recorded their answer.
3. Watch silently while the map generates. No pointing, no nodding at the
   screen.
4. **One watch counts.** If they ask to see it again, you can replay it, but
   mark everything said after that as "second watch" in the notes — it doesn't
   count toward pass/fail.
5. Write their answers **verbatim**, in their words, before you move on.
6. Honest-scope note: the app itself names things while it runs — a
   "Stage: Elevation / Moisture / Biomes" status line, and the tagline under the
   title mentions all three concepts. That's the product as shipped, so leave
   it. Just note in the results whether the person *described what they saw* or
   mainly *read the on-screen words aloud* — both are useful, they're not worth
   the same.

### Script — read aloud

> "This is a little map generator. I'm going to have it make one map, and I just
> want you to watch. Don't click anything. When it's done I'll ask you what you
> saw."

Then reload the page (or press **Generate**) so a fresh generation plays out.
When it finishes, ask, in this order:

1. **"Walk me through what you just saw happen, from start to finish."**
   (This is the unprompted one — record every word.)
2. Only if their answer didn't already cover something, stay neutral:
   - "Did the picture change in different ways at different moments? How?"
   - "What did you make of the colors?"
3. Last, you may now name things: "Anything about this confusing or unclear?"

That last answer is where surprises go — anything confusing is worth recording
even when the person passes.

---

## Section B — real-device spot-checks (10 min)

These four items were routed here from the performance validation (T16), which
could prove speeds on desktop browsers and emulated phones but cannot drive
real hardware. Original wording, quoted from the production log:

> (1) open the deployed URL on real Safari (iOS or macOS): confirm the staged
> animation is smooth and both sliders respond without visible stutter; (2) same
> on a mid-range Android device (Pixel a-class or similar): if a Generate/dice
> press feels slow, time it (budget <300 ms); (3) tap Share on a real device and
> paste the link into a fresh tab — map must be identical; (4) optional:
> DevTools mobile CPU throttle 6× spot-check of first load.

Note on "deployed URL": the public site doesn't exist yet (that's the next task,
T18). Use the **Network URL** from startup on both phones instead. After the
site is live, re-running items 1–3 against the public URL is a welcome bonus.

Devices you need: any iPhone **or** Mac (real Safari), and one mid-range
Android phone (something a few years old is perfect — the point is *not* a
flagship).

### B1 — Real Safari (iPhone or Mac)

- Open the Network URL in Safari. Let the first map generate.
- Press **Generate** and 🎲 once each; drag both the **Elevation** and
  **Moisture** sliders slowly across their range.
- **Pass:** the reveal animation plays smoothly, and sliders track your finger
  with no visible stutter or freezing.
- **Evidence:** one screenshot mid-reveal, one of the final map, plus a
  one-line verdict in the template.

### B2 — Mid-range Android, timing

- Same page in Chrome on the Android phone.
- Press **Generate** and 🎲 a few times.
- **Pass:** every press feels instant — the animation kicks off immediately,
  with no dead lag. The reveal itself takes ~3 seconds by design; that's not
  slowness.
- **If a press feels slow:** time it with a stopwatch — start the moment you
  press, stop at the first visible change. Write the number down. Consistently
  over **0.3 seconds** = fail, with your measurements noted.
- **Evidence:** screenshot of the final map + timing notes.

### B3 — Share round-trip, on a real device

- Tap **Share**. On phones it may not copy silently (phone browsers restrict
  clipboard on non-https pages) — the app then shows a "Share this link" box
  with the URL pre-selected; long-press → copy that. Either path is fine.
- Open a fresh tab, paste, go.
- **Pass:** the fresh tab shows the *identical* map — same shapes, same colors,
  and the Seed box shows the same number.
- **Evidence:** screenshot of the pasted-link tab.

### B4 — Optional: 6× CPU-throttled first load (desktop, only if comfortable)

- On your computer in Chrome: DevTools (⌘⌥I / F12) → Performance panel →
  "CPU: 4×" dropdown → change to **6×** → reload the page.
- **Pass:** the page stays usable; the animation plays with at most a brief
  hitch right when the map first appears (that's the known tight spot).
- **Evidence:** one line in the template — smooth / hitched / froze.

---

## Section C — evidence

Everything goes in **`docs/ultron/evidence/t17/`**:

- `t17-results.md` — the fill-in template (already in place). Fill it as you go.
- Screenshots: same folder, suggested names `safari-mid-reveal.png`,
  `safari-final-map.png`, `android-final-map.png`, `share-fresh-tab.png`.
- How to screenshot: iPhone = Side + Volume Up · Mac = ⇧⌘4 · Android = Power +
  Volume Down.

The template captures: each participant's verbatim answers, pass/fail per
concept family, the Section B verdicts + device models, and anything
surprising.

---

## Section D — what happens after

1. Hand the filled-in `t17-results.md` (and screenshots) back to the
   coordinator.
2. **All pass** → T17 is recorded complete, and the site deploy (T18) goes
   ahead.
3. **Anything fails or surprises** → a fix cycle runs first; only the failed
   parts get re-checked afterward. Nothing deploys on top of a failed check.

One honesty reminder for the record: the two people in Section A are real
testers, not stand-ins — their actual words are the evidence, so capture them
before you explain anything.
