// @vitest-environment happy-dom
//
// Biome legend unit tests (onboard pass): the legend is DATA-DRIVEN from the
// same BIOME_IDS/BIOMES the renderer classifies against — these tests pin
// that coupling (order, names, committed hexes) so the key can never drift
// from the pixels it explains.
import { describe, expect, it } from 'vitest';
import { populateBiomeLegend } from './biome-legend.ts';
import { BIOMES, BIOME_IDS } from '../generation/biomes.ts';

function buildHost(): HTMLElement {
  const host = document.createElement('div');
  host.id = 'legend-swatches';
  document.body.append(host);
  return host;
}

describe('biome legend (onboard)', () => {
  it('renders one entry per biome, in palette order (Deep Ocean → Snow)', () => {
    const host = buildHost();
    populateBiomeLegend(host);
    const entries = [...host.querySelectorAll('.legend-entry')];
    expect(entries).toHaveLength(BIOME_IDS.length); // 12 committed biomes
    expect(entries.map((e) => e.querySelector('.legend-name')?.textContent)).toEqual(
      BIOME_IDS.map((id) => BIOMES[id].name),
    );
  });

  it('each swatch carries its biome\'s committed hex; the label carries the meaning', () => {
    const host = buildHost();
    populateBiomeLegend(host);
    const entries = [...host.querySelectorAll('.legend-entry')];
    for (let i = 0; i < BIOME_IDS.length; i += 1) {
      const swatch = entries[i]!.querySelector<HTMLElement>('.legend-swatch');
      // The color rides on the swatch, the NAME on the text — no
      // color-alone meaning (and the swatch is aria-hidden decoration).
      expect(swatch?.style.background).toBe(BIOMES[BIOME_IDS[i]!].hex);
      expect(swatch?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('is idempotent — repopulating never duplicates entries', () => {
    const host = buildHost();
    populateBiomeLegend(host);
    populateBiomeLegend(host);
    expect(host.querySelectorAll('.legend-entry')).toHaveLength(BIOME_IDS.length);
  });
});
