// Node-env registry tests (plan T12): the three fixed presets as data —
// wire-id shape (T13's /^[a-z]{1,24}$/ pattern), slider bounds, override-key
// allowlist, and lookup behavior. No DOM, no controller.
import { describe, expect, it } from 'vitest';
import { PRESETS, findPreset } from './presets.ts';
import type { PresetOverrideKeys } from './presets.ts';

/** T13's wire pattern for preset ids (see src/state/urlState.ts). */
const PRESET_ID_PATTERN = /^[a-z]{1,24}$/;

const OVERRIDE_KEYS: ReadonlyArray<keyof PresetOverrideKeys> = [
  'falloffStrength',
  'elevationFreq',
  'elevationOctaves',
  'moistureFreq',
  'moistureOctaves',
  'elevationNormLow',
  'elevationNormHigh',
];

describe('T12 preset registry', () => {
  it('is exactly the three committed presets, in order, with unique ids', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['archipelago', 'continent', 'highlands']);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(3);
    expect(PRESETS.map((p) => p.name)).toEqual(['Archipelago', 'Continent', 'Highlands']);
  });

  it('every id matches the T13 wire pattern /^[a-z]{1,24}$/', () => {
    for (const preset of PRESETS) {
      expect(preset.id).toMatch(PRESET_ID_PATTERN);
    }
  });

  it('slider positions are finite numbers within [0,1]', () => {
    for (const preset of PRESETS) {
      for (const [key, value] of [
        ['elevation', preset.elevation],
        ['moisture', preset.moisture],
      ] as const) {
        expect(Number.isFinite(value), `${preset.id}.${key} finite`).toBe(true);
        expect(value, `${preset.id}.${key} in [0,1]`).toBeGreaterThanOrEqual(0);
        expect(value, `${preset.id}.${key} in [0,1]`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('overrides touch only allowed keys, with sane values', () => {
    for (const preset of PRESETS) {
      for (const key of Object.keys(preset.overrides) as Array<keyof PresetOverrideKeys>) {
        expect(OVERRIDE_KEYS, `${preset.id} override key ${key}`).toContain(key);
      }
      // redistribution remains the one slider-derived key a preset must never
      // override (T6's committed mapping owns it). elevationFreq joined the
      // allowlist in T3c: feature SCALE is terrain character, and the
      // coherence fix needed bigger features than the slider-derived values
      // reach at the presets' slider positions.
      expect(preset.overrides).not.toHaveProperty('redistribution');
      if (preset.overrides.elevationFreq !== undefined) {
        expect(preset.overrides.elevationFreq, `${preset.id} freq > 0`).toBeGreaterThan(0);
        expect(preset.overrides.elevationFreq, `${preset.id} freq sane`).toBeLessThanOrEqual(6);
      }

      const octaves = preset.overrides.elevationOctaves ?? preset.overrides.moistureOctaves;
      if (octaves !== undefined) {
        expect(Number.isInteger(octaves)).toBe(true);
        expect(octaves).toBeGreaterThanOrEqual(1);
      }
      if (preset.overrides.falloffStrength !== undefined) {
        expect(preset.overrides.falloffStrength).toBeGreaterThanOrEqual(0);
        expect(preset.overrides.falloffStrength).toBeLessThanOrEqual(1);
      }
      // T3b normalization shoulders: valid percentile ranks, low strictly
      // below high (a degenerate pair would silently skip normalization).
      if (preset.overrides.elevationNormLow !== undefined) {
        expect(preset.overrides.elevationNormLow).toBeGreaterThanOrEqual(0);
        expect(preset.overrides.elevationNormLow).toBeLessThan(1);
      }
      if (preset.overrides.elevationNormHigh !== undefined) {
        expect(preset.overrides.elevationNormHigh).toBeGreaterThan(0);
        expect(preset.overrides.elevationNormHigh).toBeLessThanOrEqual(1);
      }
      if (
        preset.overrides.elevationNormLow !== undefined &&
        preset.overrides.elevationNormHigh !== undefined
      ) {
        expect(preset.overrides.elevationNormLow).toBeLessThan(preset.overrides.elevationNormHigh);
      }
    }
  });

  it('terrain characters differ: no two presets share both slider positions', () => {
    const signatures = PRESETS.map(
      (p) => `${p.elevation.toFixed(2)}:${p.moisture.toFixed(2)}:${JSON.stringify(p.overrides)}`,
    );
    expect(new Set(signatures).size).toBe(PRESETS.length);
  });

  it('findPreset resolves known ids to the registry object and everything else to null', () => {
    expect(findPreset('continent')).toBe(PRESETS[1]);
    expect(findPreset('archipelago')).toBe(PRESETS[0]);
    expect(findPreset('highlands')).toBe(PRESETS[2]);
    expect(findPreset('nope')).toBeNull();
    expect(findPreset('')).toBeNull();
    expect(findPreset('Continent')).toBeNull(); // case-sensitive wire slug
    expect(findPreset(null)).toBeNull();
  });
});
