import type { BlipEffect, BlipPixelEffects } from './blip-effects.js';
import type { EffectBuffer } from './image-effect-frame.js';
import type { Shadow } from '../types/common.js';

/** Lower compound EG_Effect members to the same bounded primitive pipeline.
 * All distances enter as EMUs. No host renderer or parser is consulted here. */
export function expandBlipEffect(effect: BlipEffect, input: Pick<EffectBuffer, 'width' | 'height' | 'frame'>,
  value: BlipPixelEffects): readonly BlipEffect[] | undefined {
  const frame = input.frame ?? { x: 0, y: 0, width: input.width, height: input.height };
  const ex = value.emuPerPixelX ?? 9525, ey = value.emuPerPixelY ?? 9525;
  const transform = (sx: number, sy: number, kx: number, ky: number, tx: number, ty: number): BlipEffect =>
    ({ type: 'transform', sx, sy, kx, ky, tx, ty });
  const aligned = (s: Shadow): BlipEffect => {
    const align = s.algn ?? 'b';
    const ax = align.endsWith('r') || align === 'r' ? frame.width : ['t', 'ctr', 'b'].includes(align) ? frame.width / 2 : 0;
    const ay = align.startsWith('b') ? frame.height : ['l', 'ctr', 'r'].includes(align) ? frame.height / 2 : 0;
    const sx = s.sx ?? 1, sy = s.sy ?? 1, kx = s.kx ?? 0, ky = s.ky ?? 0;
    return transform(sx, sy, kx, ky,
      s.dist * Math.cos(s.dir * Math.PI / 180) + ax * (1 - sx) * ex - Math.tan(kx * Math.PI / 180) * ay * ey,
      s.dist * Math.sin(s.dir * Math.PI / 180) + ay * (1 - sy) * ey - Math.tan(ky * Math.PI / 180) * ax * ex);
  };
  switch (effect.type) {
    case 'relativeOffset': // §20.1.8.51, percentages of the authored frame.
      return [transform(1, 1, 0, 0, effect.tx * frame.width * ex, effect.ty * frame.height * ey)];
    case 'glow': // §20.1.8.32: colored, blurred parent coverage.
      return [{ type: 'colorReplace', color: effect.glow.color }, { type: 'alphaModFix', amt: effect.glow.alpha },
        { type: 'blur', radius: effect.glow.radius, grow: true }];
    case 'shadow':
      if (effect.inner) return undefined;
      // §20.1.8.45: align, scale/skew, offset; then blur the colored alpha.
      return [{ type: 'colorReplace', color: effect.shadow.color }, { type: 'alphaModFix', amt: effect.shadow.alpha },
        aligned(effect.shadow), { type: 'blur', radius: effect.shadow.blur, grow: true }];
    case 'presetShadow': // §20.1.10.52 resolves these to ordinary shadows.
      return [{ type: 'container', container: { kind: 'sib', effects:
        effect.shadows.map(shadow => ({ type: 'shadow', shadow, inner: false })) } }];
    case 'softEdge':
      // §20.1.8.53 blurs edges while leaving the fill unaffected: radius zero
      // is exact identity, including on translucent pixels. Rasterization
      // policy: feather the nonzero coverage silhouette with our shared blur
      // kernel, then apply that mask once to the original alpha. Blurring the
      // original opacity instead would square it, darkening the entire fill.
      return effect.radius === 0 ? [] : [{ type: 'alphaMod', container: { kind: 'tree', effects: [
        { type: 'alphaCeiling' }, { type: 'blur', radius: effect.radius, grow: false },
      ] } }];
    default: return undefined;
  }
}

/** Operations evaluated on an independent mask copy. Keeping the same
 * expansion in planning and execution binds geometry/work to the actual
 * kernels, including a reflection's transformed and grown grid. */
export function blipMaskOperations(effect: BlipEffect,
  input: Pick<EffectBuffer, 'width' | 'height' | 'frame'>, value: BlipPixelEffects): readonly BlipEffect[] | undefined {
  if (effect.type === 'alphaOutset') return [
    { type: 'alphaCeiling' }, { type: 'blur', radius: Math.abs(effect.radius), grow: effect.radius > 0 },
    { type: effect.radius >= 0 ? 'alphaCeiling' : 'alphaFloor' },
  ];
  if (effect.type === 'shadow' && effect.inner) return [
    { type: 'blur', radius: effect.shadow.blur, grow: true },
    { type: 'transform', sx: 1, sy: 1, kx: 0, ky: 0,
      tx: effect.shadow.dist * Math.cos(effect.shadow.dir * Math.PI / 180),
      ty: effect.shadow.dist * Math.sin(effect.shadow.dir * Math.PI / 180) },
  ];
  if (effect.type === 'reflection') {
    const r = effect.reflection, f = input.frame ?? { width: input.width, height: input.height };
    const ex = value.emuPerPixelX ?? 9525, ey = value.emuPerPixelY ?? 9525, align = r.algn ?? 'b';
    const ax = align.endsWith('r') || align === 'r' ? f.width * ex : ['t', 'ctr', 'b'].includes(align) ? f.width * ex / 2 : 0;
    const ay = align.startsWith('b') ? f.height * ey : ['l', 'ctr', 'r'].includes(align) ? f.height * ey / 2 : 0;
    return [{ type: 'transform', sx: r.sx, sy: r.sy, kx: r.kx ?? 0, ky: r.ky ?? 0,
      tx: r.dist * Math.cos(r.dir * Math.PI / 180) + ax * (1 - r.sx) - Math.tan((r.kx ?? 0) * Math.PI / 180) * ay,
      ty: r.dist * Math.sin(r.dir * Math.PI / 180) + ay * (1 - r.sy) - Math.tan((r.ky ?? 0) * Math.PI / 180) * ax },
      { type: 'blur', radius: r.blur, grow: true }];
  }
  return undefined;
}
