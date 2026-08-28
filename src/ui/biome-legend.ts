/**
 * The biome legend (onboard pass) — the map's key, specimen-side.
 *
 * The critique's P1-3: twelve committed colors with no key anywhere means
 * the map's meaning is locked behind luck-of-the-hover. The legend is built
 * from the SAME `BIOME_IDS`/`BIOMES` data the renderer classifies against,
 * so it can never drift from the pixels it explains (add a biome, the key
 * grows; rename one, the key follows).
 *
 * Form follows the world's quiet: a native `<details>` — collapsed to one
 * muted "Biome legend" line under the caption block until the visitor asks,
 * keyboard-accessible by virtue of the platform, zero cost when closed. Each
 * entry is a swatch square plus the biome's name, so no meaning rides on
 * color alone.
 */

import { BIOMES, BIOME_IDS } from '../generation/biomes.ts';

/** Swatch list host id (index.html ships the static details skeleton). */
export const LEGEND_SWATCHES_ID = 'legend-swatches';

/**
 * Populate the static `<details id="biome-legend">` skeleton (index.html)
 * with one swatch entry per biome, in palette order (Deep Ocean → Snow).
 * Idempotent: clears the host first, so re-population never duplicates.
 */
export function populateBiomeLegend(host: HTMLElement): void {
  host.replaceChildren();
  for (const id of BIOME_IDS) {
    const biome = BIOMES[id];
    const entry = document.createElement('span');
    entry.className = 'legend-entry';

    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = biome.hex;
    // Name the color for non-visual contexts; the adjacent text label
    // carries the meaning, so the swatch itself stays decorative.
    swatch.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'legend-name';
    label.textContent = biome.name;

    entry.append(swatch, label);
    host.append(entry);
  }
}
