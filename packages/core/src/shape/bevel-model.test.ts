import { prepareLighting, rigVector, shadeSurface } from './bevel-lighting';
import { describe, expect, it } from 'vitest';
import {
  applyBevelShading,
  bevelHeightProfile,
  lightDirFromRig,
  materialClass,
  type BevelCtx,
} from './bevel-shading';

function render(
  material = 'matte',
  rig = 'threePt',
  dir = 't',
  rot?: { lat: number; lon: number; rev: number },
) {
  const data = new Uint8ClampedArray(40 * 40 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([80, 100, 140, 255], i);
  const ctx: BevelCtx = {
    canvas: { width: 40, height: 40 },
    getImageData: () =>
      ({ data: data.slice(), width: 40, height: 40 }) as ImageData,
    putImageData: (image) => {
      data.set(image.data);
    },
  };
  applyBevelShading(ctx, {
    widthPx: 8,
    heightPx: 8,
    prst: 'circle',
    material: materialClass(material),
    light: lightDirFromRig(rig, dir, rot),
  });
  return data;
}

describe('documented DrawingML bevel model', () => {
  it('preserves material identity through the existing caller adapter', () => {
    for (const name of [
      'legacyMatte',
      'legacyPlastic',
      'legacyMetal',
      'legacyWireframe',
      'matte',
      'plastic',
      'metal',
      'warmMatte',
      'translucentPowder',
      'powder',
      'dkEdge',
      'softEdge',
      'clear',
      'flat',
      'softmetal',
    ]) {
      expect(materialClass(name)).toBe(name);
    }
  });
  it('uses the documented circle coordinates (height x, inward distance y)', () => {
    const circle = bevelHeightProfile('circle', 10);
    // Cubic midpoint: x=.29139875, y=.70860125, rather than the old quarter-circle stand-in.
    expect(circle(7.0860125)).toBeCloseTo(0.29139875, 3);
    expect(bevelHeightProfile('angle', 10)(5)).toBeCloseTo(0.5, 5);
    // cross ends at height .6, which Office stretches to full height.
    expect(bevelHeightProfile('cross', 10)(5)).toBeCloseTo(5 / 6, 3);
  });
  it('keeps all documented profile envelopes finite and selects visible overhangs', () => {
    for (const name of [
      'angle',
      'artDeco',
      'circle',
      'convex',
      'coolSlant',
      'cross',
      'divot',
      'hardEdge',
      'relaxedInset',
      'riblet',
      'slope',
      'softRound',
    ]) {
      const profile = bevelHeightProfile(name, 1);
      for (let i = 0; i <= 100; i++) {
        expect(Number.isFinite(profile(i / 100))).toBe(true);
        expect(profile(i / 100)).toBeGreaterThanOrEqual(0);
        expect(profile(i / 100)).toBeLessThanOrEqual(1);
      }
    }
    // Divot has multiple intersections at y=.5; the later raised surface hides
    // the first low branch. relaxedInset's raised face starts at y=.64.
    expect(bevelHeightProfile('divot', 1)(0.5)).toBeGreaterThan(0.9);
    expect(bevelHeightProfile('relaxedInset', 1)(0.75)).toBe(1);
  });
  it('explicit rotation replaces direction, including latitude and longitude', () => {
    const rot = { lat: 25, lon: 35, rev: 15 };
    expect(render('matte', 'morning', 't', rot)).toEqual(
      render('matte', 'morning', 'r', rot),
    );
    expect(render('matte', 'morning', 't', rot)).not.toEqual(
      render('matte', 'morning', 't', { lat: 0, lon: 0, rev: 15 }),
    );
  });
  it('shades the flat face and retains colored rig and material responses', () => {
    const center = (20 * 40 + 20) * 4;
    expect([...render().slice(center, center + 3)]).not.toEqual([80, 100, 140]);
    expect(render('matte', 'sunset')).not.toEqual(render('matte', 'threePt'));
    expect(render('powder')).not.toEqual(render('legacyMetal'));
    expect(render('translucentPowder')[center + 3]).toBeLessThan(255);
  });
});

// Independent arithmetic expectations exercise production lighting rather than
// copying the implementation's table or checking its private representation.

describe('reference lighting arithmetic and unsupported surfaces', () => {
  it('uses ambient-only diffuse in contrasting, including the powder color mix', () => {
    const out = new Float64Array(4);
    shadeSurface(
      out,
      80,
      100,
      140,
      255,
      0,
      0,
      1,
      prepareLighting('matte', rigVector('contrasting', 't')),
    );
    expect([...out]).toEqual([80, 100, 140, 255]);
    shadeSurface(
      out,
      80,
      100,
      140,
      255,
      0,
      0,
      1,
      prepareLighting('powder', rigVector('contrasting', 't')),
    );
    expect(out[0]).toBeCloseTo((80 + 255) / 2, 8);
    expect(out[1]).toBeCloseTo((100 + 255) / 2, 8);
  });
  it('normalizes legacy direction vectors and preserves their light energy', () => {
    const out = new Float64Array(4);
    shadeSurface(
      out,
      80,
      100,
      140,
      255,
      0,
      0,
      1,
      prepareLighting('legacyMatte', rigVector('legacyNormal1', 't')),
    );
    expect(out[0]).toBeCloseTo(80 * (0.153 + 0.671 + 0.366), 8);
    expect(out[1]).toBeCloseTo(100 * (0.153 + 0.671 + 0.366), 8);
  });
  it('uses the documented signed negative light contribution before clamping', () => {
    const out = new Float64Array(4);
    shadeSurface(
      out,
      80,
      100,
      140,
      255,
      0,
      0,
      1,
      prepareLighting('matte', rigVector('brightRoom', 't')),
    );
    // Only ambient 1.5 and the negative frontal diffuse light -.5 contribute.
    for (const [i, expected] of [80, 100, 140, 255].entries())
      expect(out[i]).toBeCloseTo(expected, 8);
  });
  it('leaves the top surface alone when asked to shade an invisible bottom face', () => {
    const data = new Uint8ClampedArray([80, 100, 140, 255]);
    const ctx: BevelCtx = {
      canvas: { width: 1, height: 1 },
      getImageData: () => ({ data }) as ImageData,
      putImageData: () => {
        throw new Error('Back surface is not in the front bitmap');
      },
    };
    applyBevelShading(ctx, {
      widthPx: 8,
      heightPx: 8,
      prst: 'circle',
      material: 'metal',
      light: lightDirFromRig('threePt', 't'),
      bottom: true,
    });
    expect([...data]).toEqual([80, 100, 140, 255]);
  });
  it('defaults unknown preset names safely, including object property names', () => {
    expect(lightDirFromRig('constructor', '__proto__')).toEqual(
      lightDirFromRig('threePt', 't'),
    );
    expect(materialClass('__proto__')).toBe('matte');
    expect(bevelHeightProfile('constructor', 10)(5)).toEqual(
      bevelHeightProfile('circle', 10)(5),
    );
  });
});
