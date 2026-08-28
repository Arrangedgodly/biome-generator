# T17 Results — fill in during the test

Runbook: `docs/ultron/t17-human-test-protocol.md`. Fill this file in as you go;
drop screenshots in this same folder. When done, hand it back to the coordinator.

- Date: ____
- Run by: ____

---

## Section A — comprehension test (two participants)

Run each person separately. Record answers **verbatim, before explaining
anything**. One watch counts; anything said after a replay gets marked
"second watch".

### Participant 1

- Description (age range / background, optional, no names): ____
- Described vs. mainly read the on-screen stage words aloud: ____
- Q1 "Walk me through what you just saw happen, start to finish":
  > ____
- Follow-ups (only if needed) — answers:
  > ____
- "Anything confusing or unclear?" — answer:
  > ____

| Concept family | Covered? (pass/fail) | The words they used |
|---|---|---|
| 1 Height / elevation | | |
| 2 Water / moisture | | |
| 3 Biomes / colors | | |

- **Participant 1 verdict:** ☐ pass (all three) ☐ fail — which were missing: ____

### Participant 2

- Description (age range / background, optional, no names): ____
- Described vs. mainly read the on-screen stage words aloud: ____
- Q1 "Walk me through what you just saw happen, start to finish":
  > ____
- Follow-ups (only if needed) — answers:
  > ____
- "Anything confusing or unclear?" — answer:
  > ____

| Concept family | Covered? (pass/fail) | The words they used |
|---|---|---|
| 1 Height / elevation | | |
| 2 Water / moisture | | |
| 3 Biomes / colors | | |

- **Participant 2 verdict:** ☐ pass (all three) ☐ fail — which were missing: ____

**Section A overall: ☐ PASS (both passed) ☐ FAIL**

---

## Section B — real-device spot-checks

### B1 — Real Safari

- Device + OS (e.g. iPhone 14, iOS 17): ____
- Animation smooth? ☐ yes ☐ no — details: ____
- Both sliders track without visible stutter? ☐ yes ☐ no — details: ____
- **Verdict:** ☐ pass ☐ fail
- Screenshots: `safari-mid-reveal.png` ☐ · `safari-final-map.png` ☐

### B2 — Mid-range Android, timing

- Device + Android version: ____
- Generate / 🎲 presses feel instant? ☐ yes ☐ no
- If timed: press → first visible change, per press: ____ s
- **Verdict:** ☐ pass ☐ fail (fail = consistently over 0.3 s, with numbers above)
- Screenshots: `android-final-map.png` ☐ · timing notes above

### B3 — Share round-trip (either phone)

- Device + browser: ____
- Copy path used: ☐ copied silently ("Copied!") ☐ "Share this link" box, copied manually
- Fresh tab shows the identical map (same shapes + same Seed number)? ☐ yes ☐ no
- **Verdict:** ☐ pass ☐ fail
- Screenshot: `share-fresh-tab.png` ☐

### B4 — Optional: 6× CPU-throttled first load (desktop Chrome DevTools)

- Skipped ☐ · Run: first load looked ☐ smooth ☐ brief hitch at map appearance ☐ froze

---

## Surprises

Anything unexpected, confusing, or broken — from participants or devices:

> ____

---

## Final verdict

- **T17 overall: ☐ PASS ☐ PASS with notes ☐ FAIL**
- Notes for the coordinator: ____
