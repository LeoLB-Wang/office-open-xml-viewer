import { GeometryWorkBudgetError, resolveDrawingMLGeometry } from '@silurus/ooxml-core';
import type { DrawingMLShapePaintPlan } from '@silurus/ooxml-core';
import type { DeepReadonly, VmlShapeAcquisitionFacts, Matrix2DData } from './types.js';
import { projectPath } from './vml-shadow.js';

/** Part 4 §19.2.2.31 / MS-OI29500 §2.1.1842: skew acts on vector
 * geometry after the shape's rotation/reflection, around its authored origin.
 * Image data retains its original brush frame; only its vector clip moves.
 * Only the unambiguous affine zero-perspective case is acquired. */
export function acquireVmlSkew(
  plan: DrawingMLShapePaintPlan,
  skew: DeepReadonly<NonNullable<VmlShapeAcquisitionFacts['vmlSkew']>>,
  maximumWork = Infinity,
): DrawingMLShapePaintPlan & { resolvedGeometry: NonNullable<DrawingMLShapePaintPlan['resolvedGeometry']> } {
  maximumWork = Math.min(maximumWork, 1_048_576);
  let work = 0;
  const charge = () => {
    if (++work > maximumWork) throw new GeometryWorkBudgetError('VML skew geometry work budget exceeded');
  };
  const geometry = plan.resolvedGeometry ?? resolveDrawingMLGeometry(plan, 1, maximumWork);
  work += geometry.workUnits;
  if (work > maximumWork) throw new GeometryWorkBudgetError('VML skew source geometry work budget exceeded');
  const { x, y, w, h } = plan.rect;
  const matrix = acquireVmlSkewMatrix(plan, skew);
  // Algebraic identity preserves already acquired arrow retraction and exact
  // curves. Reflattening/re-resolving a decorated line would retract it twice.
  if (matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1 && matrix.e === 0 && matrix.f === 0)
    return { ...plan, resolvedGeometry: geometry };
  const zeroExtent = w === 0 || h === 0;
  const outputRect = zeroExtent ? { x: 0, y: 0, w: 1, h: 1 } : plan.rect;
  const project = (p: readonly [number, number]): readonly [number, number] => {
    charge();
    const u = matrix.a * p[0] + matrix.c * p[1] + matrix.e;
    const v = matrix.b * p[0] + matrix.d * p[1] + matrix.f;
    if (!zeroExtent) return [(u - x) / w, (v - y) / h];
    // A horizontal/vertical line has no invertible normalization box. Bake
    // its complete host frame into an ordinary unit point-space rectangle;
    // this changes only the geometry coordinate basis, not its allocation.
    const cx = x + w / 2, cy = y + h / 2, theta = plan.transform.rotationDeg * Math.PI / 180;
    const dx = (u - cx) * (plan.transform.flipH ? -1 : 1), dy = (v - cy) * (plan.transform.flipV ? -1 : 1);
    return [cx + Math.cos(theta) * dx - Math.sin(theta) * dy,
      cy + Math.sin(theta) * dx + Math.cos(theta) * dy];
  };
  // Keep nondegenerate shapes' brush rectangles. The bounded curve authority
  // operates in output points before normalization, preserving its precision.
  const subpaths = geometry.paths.map(path => projectPath(path.path, p => {
    const point = project(p);
    return [point[0] * outputRect.w + outputRect.x, point[1] * outputRect.h + outputRect.y];
  }, charge).map(command => 'x' in command && 'y' in command ? { ...command,
    x: (command.x - outputRect.x) / outputRect.w, y: (command.y - outputRect.y) / outputRect.h } : command));
  const acquired: DrawingMLShapePaintPlan = {
    ...plan,
    rect: outputRect,
    geometry: { kind: 'custom', subpaths, paint: geometry.paths.map(path => ({
      fillRule: path.fillRule,
      ...(path.fill === 'none' ? { fill: 'none' as const } : {}),
      ...(path.stroke ? {} : { stroke: false as const }),
    })) },
    transform: zeroExtent ? { rotationDeg: 0, flipH: false, flipV: false } : { ...plan.transform },
  };
  const resolvedGeometry = resolveDrawingMLGeometry(acquired, 1, maximumWork - work);
  return { ...acquired, resolvedGeometry: { ...resolvedGeometry, workUnits: work + resolvedGeometry.workUnits } };
}

/** Conjugate the post-host skew into the retained host's local point frame.
 * Keeping the original host transform preserves image rotation/reflection;
 * §19.2.2.31 excludes only skew from image data, not the host transform. */
export function acquireVmlSkewMatrix(
  plan: Pick<DrawingMLShapePaintPlan, 'rect' | 'transform'>,
  skew: DeepReadonly<NonNullable<VmlShapeAcquisitionFacts['vmlSkew']>>,
): Matrix2DData {
  const { x, y, w, h } = plan.rect;
  const [sxx, sxy, syx, syy, px, py] = skew.matrix;
  if (px !== 0 || py !== 0) throw new Error('Projective VML skew requires resolved reciprocal-factor semantics');
  const cx = x + w / 2, cy = y + h / 2;
  const ox = cx + w * skew.origin[0], oy = cy + h * skew.origin[1];
  const dx = skew.offset.xPt + skew.offset.xFraction * w;
  const dy = skew.offset.yPt + skew.offset.yFraction * h;
  const theta = plan.transform.rotationDeg * Math.PI / 180;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const fx = plan.transform.flipH ? -1 : 1, fy = plan.transform.flipV ? -1 : 1;
  const project = (x: number, y: number) => {
    const vx = (x - cx) * fx, vy = (y - cy) * fy;
    const u = cx + cos * vx - sin * vy - ox, v = cy + sin * vx + cos * vy - oy;
    const sx = ox + sxx * u + syx * v + dx - cx;
    const sy = oy + sxy * u + syy * v + dy - cy;
    return { x: cx + fx * (cos * sx + sin * sy), y: cy + fy * (-sin * sx + cos * sy) };
  };
  const p = project(0, 0), a = project(1, 0), b = project(0, 1);
  return { a: a.x - p.x, b: a.y - p.y, c: b.x - p.x, d: b.y - p.y, e: p.x, f: p.y };
}
