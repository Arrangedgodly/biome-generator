// @vitest-environment happy-dom
//
// Layout smoke test (plan T9) — guards structure, not pixels.
//
// Three surfaces:
//   1. index.html skeleton: parsed from the real file (DOMParser) — canvas
//      512² + labeled controls aside in source order, header, module script
//      (the entry that imports style.css — this Vite app ships no separate
//      <link> stylesheet in source HTML).
//   2. The real control-panel builder mounted into a fresh aside: sliders,
//      seed input, button inventory, aria-live stage line, alert region,
//      enabled T12 presets, enabled T14 share/export buttons.
//   3. style.css content: the D2 canvas upscale fallback ordering, the
//      responsive/reduced-motion guards, and WCAG contrast of the theme
//      tokens parsed straight out of the :root block.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildControlPanel } from './control-panel.ts';
import type { ControlPanelPorts } from './control-panel.ts';

// node:url/node:path helpers rather than `new URL(..., import.meta.url)`:
// the happy-dom environment replaces the global URL constructor, which
// rejects file:-scheme bases.
const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(here, '../../index.html'), 'utf8');
const stylesheet = readFileSync(resolve(here, '../style.css'), 'utf8');

/** Parses a `--token: #rrggbb;` custom property out of the stylesheet. */
function cssToken(name: string): string {
  const match = stylesheet.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  expect(match, `style.css must define --${name}`).toBeTruthy();
  return match![1].toLowerCase();
}

/** WCAG 2.2 relative luminance (same helper intent as biome-palette.test.ts). */
function wcagLuminance(hex: string): number {
  const channel = (i: number): number => parseInt(hex.slice(1 + i, 3 + i), 16) / 255;
  const linearize = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return (
    0.2126 * linearize(channel(0)) + 0.7152 * linearize(channel(2)) + 0.0722 * linearize(channel(4))
  );
}

function contrastRatio(a: string, b: string): number {
  const la = wcagLuminance(a);
  const lb = wcagLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function makePorts(): ControlPanelPorts {
  const noop = (): void => {};
  return {
    controller: {
      setElevation: noop,
      commitElevation: noop,
      setMoisture: noop,
      setSeed: noop,
      regenerate: noop,
      applyPreset: noop,
      activePresetId: () => null,
      subscribe: () => () => {},
    },
    animation: {
      skip: noop,
      onStageChange: () => () => {},
      playing: false,
    },
    onRetry: noop,
    onShare: noop,
    onExport: noop,
  };
}

describe('index.html skeleton', () => {
  const doc = new DOMParser().parseFromString(indexHtml, 'text/html');

  it('has a 512×512 focusable canvas inside the #stage probe skeleton, controls aside second, inside main#app', () => {
    const app = doc.querySelector('#app');
    expect(app).not.toBeNull();
    const children = [...app!.children];
    expect(children.map((el) => el.id)).toEqual(['stage', 'controls']);

    const stage = doc.querySelector('#stage');
    expect(stage?.tagName).toBe('DIV');

    const canvas = doc.querySelector('#map-canvas') as HTMLCanvasElement | null;
    expect(canvas).not.toBeNull();
    expect(canvas!.tagName).toBe('CANVAS');
    expect(canvas!.getAttribute('width')).toBe('512');
    expect(canvas!.getAttribute('height')).toBe('512');
    // The canvas is keyboard-probeable: focusable, and its label says so.
    expect(canvas!.getAttribute('tabindex')).toBe('0');
    expect(canvas!.getAttribute('aria-label')).toBe(
      'Generated biome map — hover or use the arrow keys to probe terrain',
    );

    const aside = doc.querySelector('#controls');
    expect(aside).not.toBeNull();
    expect(aside!.tagName).toBe('ASIDE');
    expect(aside!.getAttribute('aria-label')).toBe('Map controls');
  });

  it('carries the surveyor\'s probe surfaces: aria-hidden crosshair, caption block, reserved readout, polite announcer', () => {
    const overlay = doc.querySelector('#probe-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute('aria-hidden')).toBe('true');
    for (const cls of ['probe-v', 'probe-h', 'probe-dot']) {
      expect(overlay!.querySelector(`.${cls}`), `missing .${cls}`).not.toBeNull();
    }

    // Caption block between overlay and probe reading: the panel-driven
    // stage label lives here in production (map status with the map).
    const statusHost = doc.querySelector('#stage-status');
    expect(statusHost).not.toBeNull();
    expect(statusHost!.tagName).toBe('DIV');

    const readout = doc.querySelector('#probe-readout');
    expect(readout).not.toBeNull();
    expect(readout!.tagName).toBe('P');

    const announce = doc.querySelector('#probe-announce');
    expect(announce?.getAttribute('aria-live')).toBe('polite');
    expect(announce?.classList.contains('visually-hidden')).toBe(true);
  });

  it('has the app header, viewport meta, title, and the module script that loads main.ts (and with it style.css)', () => {
    expect(doc.documentElement.getAttribute('lang')).toBe('en');
    expect(doc.title).toBe('Procedural Biome Generator');
    expect(doc.querySelector('meta[name="viewport"]')?.getAttribute('content')).toContain(
      'width=device-width',
    );
    const h1 = doc.querySelector('#app-header h1');
    expect(h1?.textContent).toBe('Procedural Biome Generator');
    const script = doc.querySelector('script[type="module"]');
    expect(script?.getAttribute('src')).toBe('/src/main.ts');
  });
});

describe('mounted control panel (real builder, fresh aside)', () => {
  const aside = document.createElement('aside');
  aside.id = 'controls';
  document.body.append(aside);
  const panel = buildControlPanel(aside, makePorts());

  it('contains 2 labeled range inputs, a labeled seed input, and 6+ buttons', () => {
    const ranges = aside.querySelectorAll<HTMLInputElement>('input[type="range"]');
    expect(ranges.length).toBe(2);
    expect([...ranges].map((r) => r.id).sort()).toEqual(['elevation-input', 'moisture-input']);
    for (const range of ranges) {
      expect(aside.querySelector(`label[for="${range.id}"]`)).not.toBeNull();
    }

    const seed = aside.querySelector<HTMLInputElement>('#seed-input');
    expect(seed?.type).toBe('text');
    expect(aside.querySelector('label[for="seed-input"]')).not.toBeNull();

    const buttons = aside.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    for (const id of [
      'dice-button',
      'generate-button',
      'skip-button',
      'preset-archipelago',
      'preset-continent',
      'preset-highlands',
      'export-button',
      'share-button',
      'retry-button',
    ]) {
      expect(aside.querySelector(`#${id}`), `missing #${id}`).not.toBeNull();
    }
  });

  it('exposes an aria-live stage line, a hidden role=alert error region, enabled T12 presets, enabled T14 share/export', () => {
    const stage = aside.querySelector<HTMLElement>('#stage-label');
    expect(stage?.getAttribute('aria-live')).toBe('polite');

    const errorRegion = aside.querySelector<HTMLElement>('#error-region');
    expect(errorRegion?.getAttribute('role')).toBe('alert');
    expect(errorRegion?.hasAttribute('hidden')).toBe(true);

    const presets = [...aside.querySelectorAll<HTMLButtonElement>('button[data-preset]')];
    expect(presets.map((b) => b.dataset.preset)).toEqual(['archipelago', 'continent', 'highlands']);
    // T12 wired the presets: enabled with unpressed toggle state.
    expect(presets.every((b) => !b.disabled)).toBe(true);
    expect(presets.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    // T14 wired share/export: enabled, with the manual-copy fallback hidden.
    expect(aside.querySelector<HTMLButtonElement>('#export-button')?.disabled).toBe(false);
    expect(aside.querySelector<HTMLButtonElement>('#share-button')?.disabled).toBe(false);
    expect(aside.querySelector<HTMLElement>('#share-fallback')?.hasAttribute('hidden')).toBe(true);
  });

  panel.destroy();
  aside.remove();
});

describe('stylesheet (src/style.css)', () => {
  it('declares the crisp-edges fallback before pixelated on the canvas (D2)', () => {
    const crispAt = stylesheet.indexOf('crisp-edges');
    const pixelAt = stylesheet.indexOf('pixelated');
    expect(crispAt).toBeGreaterThanOrEqual(0);
    expect(pixelAt).toBeGreaterThan(crispAt);
  });

  it('keeps the responsive + reduced-motion guards and a square canvas', () => {
    expect(stylesheet).toContain('@media (max-width: 640px)');
    // Anti-scroll guard is structural: the row never wraps and the stage
    // may shrink below its basis (min-width: 0) instead of forcing overflow.
    expect(stylesheet).toContain('flex-wrap: nowrap');
    expect(stylesheet).toContain('min-width: 0');
    expect(stylesheet).toContain('aspect-ratio: 1 / 1');
    expect(stylesheet).toContain('prefers-reduced-motion');
  });

  it('theme tokens meet WCAG contrast: focus ring ≥ 3:1 on bg and panel; text ≥ 4.5:1; error text ≥ 4.5:1', () => {
    const bg = cssToken('bg');
    const panelBg = cssToken('panel');
    const focus = cssToken('accent-bright');
    const text = cssToken('text');
    const dangerText = cssToken('danger-text');
    const dangerBg = cssToken('danger-bg');

    // Non-text contrast (focus outlines) — WCAG 2.2 §1.4.11.
    expect(contrastRatio(focus, bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(focus, panelBg)).toBeGreaterThanOrEqual(3);
    // Body text on both surfaces it appears on.
    expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(text, panelBg)).toBeGreaterThanOrEqual(4.5);
    // Error copy: light red on deep red, never low-contrast pure red.
    expect(contrastRatio(dangerText, dangerBg)).toBeGreaterThanOrEqual(4.5);
  });
});
