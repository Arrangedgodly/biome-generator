# T18 Deploy Runbook — Procedural Biome Generator

Your lane. Everything below the line is a step **you** run; nothing here was
executed or automated by the agent. All commands are run from the project root:

```
cd /Users/arrangedgodly/Documents/Projects/biome-generator
```

What has already been prepared for you:

- `.github/workflows/deploy.yml` — build + deploy pipeline (Node 24, full gate:
  `npm ci` → `npm test` → `npm run build`, then Pages deploy).
- `README.md` — project front page.
- Gates were certified on this exact tree: 213/213 tests, typecheck clean,
  build clean.

Expected final result: **https://YOUR-USERNAME.github.io/biome-generator/**

---

## 0. Facts that shape this runbook

- **Repo name must be `biome-generator`.** The Vite base path is hard-coded
  to `/biome-generator/` (`vite.config.ts`). A different repo name breaks every
  asset URL. If you ever want a different name, change `base` in
  `vite.config.ts` first, rebuild, and expect the URL to change accordingly.
- The local directory may already contain an empty `.git` from the scaffold
  step (branch `main`, zero commits, no remotes). That is fine — `git init -b main`
  is idempotent; Step 2 handles both cases.
- Deployment order matters: **enable the Pages source before (or right after)
  the first push**. If the first workflow run starts before Pages is set to
  "GitHub Actions", the deploy job fails — that's recoverable (see Step 6).

## 1. (Optional) re-certify the tree

You can skip this — the agent certified this exact tree — but it never hurts:

```bash
npm test && npm run typecheck && npm run build
```

## 2. Initialize git and make the initial commit

Prerequisite (only on a machine that has never made a commit): if `git commit`
has ever failed with an identity error, set it once with
`git config --global user.name "Your Name"` and
`git config --global user.email "you@example.com"`.

```bash
git init -b main          # no-op if the empty repo from scaffolding is present
git status                # sanity: should list README.md, .github/, docs/, src/, ...
git add .
git commit -m "Procedural biome generator v1"
```

`dist/` and `node_modules/` are already excluded by `.gitignore`; CI builds
`dist/` itself, so it should never be committed.

## 3. Create the GitHub repository — `biome-generator`, public

### Variant A (primary): web UI

1. Go to <https://github.com/new> (signed in as yourself).
2. Repository name: **`biome-generator`** (exactly — see Fact 1).
3. Visibility: **Public**.
4. **Do not** tick "Add a README", ".gitignore", or "license" — the repo must
   start empty or your first push will be rejected.
5. Create repository. Leave the browser tab on the empty-repo page.

### Variant B: gh CLI (only if you install it first)

The GitHub CLI is **not** installed on this machine. If you prefer the CLI
route, install and authenticate it first: `brew install gh && gh auth login`.

```bash
gh auth status                                  # confirm you're logged in
gh repo create biome-generator --public --description "Procedural biome map generator — simplex noise staged into biomes"
```

(No `--source`/`--push` flags yet — push happens in Step 5 either way.)

## 4. Enable Pages with the GitHub Actions source

### Variant A (primary): web UI

In the new repo: **Settings → Pages** (under "Code and automation") →
"Build and deployment" → **Source: GitHub Actions**.

### Variant B: gh CLI

Substitute your literal GitHub username for `YOUR-USERNAME` (same placeholder
as Step 5). gh's `{owner}` shorthand can't resolve here — it expands from the
current directory's repository or `GH_REPO`, and the local repo has no remote
yet at this step (the remote is added in Step 5).

```bash
gh api repos/YOUR-USERNAME/biome-generator/pages --method POST -f build_type=workflow
```

(If it answers 409/"already exists", the site exists — fetch it and check
`build_type`: `gh api repos/YOUR-USERNAME/biome-generator/pages --jq .build_type`.)

## 5. Connect the remote and push

```bash
git remote add origin git@github.com:YOUR-USERNAME/biome-generator.git
# (or https://github.com/YOUR-USERNAME/biome-generator.git if you don't use SSH)
git push -u origin main
```

Variant B users who prefer one command can instead, from Step 2's committed
state, skip the remote-add and run:

```bash
gh repo create biome-generator --public --source . --remote origin --push
```

## 6. Watch the first Actions run

The push itself triggers "Deploy to GitHub Pages". Watch it:

- Web: repo → **Actions** tab → the run named after your commit → both jobs
  (`build`, `deploy`) should go green (~1–2 min).
- CLI: `gh run watch` (or `gh run list --limit 1` to find it, then
  `gh run watch <run-id>`).

**If `deploy` failed** because Pages wasn't enabled yet (Step 4 done late):
enable it now, then re-run — Actions → failed run → **Re-run all jobs**, or:

```bash
gh run rerun <run-id>
```

**If `build` failed**: it can only be install/test/build — copy the failing
step's log; the full gate runs locally in ~30s, so reproduce with Step 1.

## 7. Verify the live URL

```bash
open https://YOUR-USERNAME.github.io/biome-generator/
```

Quick content check from a terminal (first deploy can lag a minute or two
behind the green checkmark):

```bash
curl -s https://YOUR-USERNAME.github.io/biome-generator/ | grep -o "<title>[^<]*</title>"
# expect: <title>Procedural Biome Generator</title>
```

Notes: `https://YOUR-USERNAME.github.io/` alone will **not** serve the app —
it lives at the `/biome-generator/` subpath (Fact 1). The page loads over
HTTPS with no console errors about mixed content or failed assets.

## 8. Post-deploy smoke checklist

On the live URL, confirm each item:

| # | Check | Passes when |
|---|---|---|
| 1 | First load | Staged animation plays (elevation → moisture → biomes) and settles on a full-color map |
| 2 | Generate | Pressing Generate re-plays the staged animation and settles on the same map (seed determinism); 🎲 produces a new map |
| 3 | Dice | 🎲 produces a different map; same seed typed manually reproduces a map exactly |
| 4 | Preset switch | Archipelago / Continent / Highlands give visibly different terrain characters |
| 5 | Share link | Share copies the URL; opening it on **another device** renders the identical map |
| 6 | Export | Export downloads a PNG that matches the on-screen map |
| 7 | Sliders (bonus) | Dragging elevation stays responsive (256² preview), moisture recolors instantly |

## 9. Known constraints and follow-ups

- **Base path**: fixed to `/biome-generator/`; repo name must match (Fact 1).
- **Optional Safari re-check (routed from T17/T16)**: the real-Safari
  smoothness item on the human-test checklist can now be re-run against the
  public URL instead of the local preview build — see
  `docs/ultron/t17-human-test-protocol.md`, Section B, item 1. This was
  explicitly marked "welcome bonus", not a blocker.
- **README screenshot**: after deploy, take a real screenshot, drop it at
  `docs/screenshot.png` (or anywhere stable), and update the image path in
  `README.md` (there is a TODO marker there).
- Re-deploys are automatic on every push to `main`; manual re-deploy is
  Actions → "Deploy to GitHub Pages" → Run workflow.

## 10. Report back

Paste into the session (or hand to the coordinator): the live URL, the
Actions run link, and which smoke-checklist items passed. T18 acceptance is
"public URL serves latest build; deterministic rebuild" — the run is your
rebuild evidence, and the URL fetch above is the content check.
