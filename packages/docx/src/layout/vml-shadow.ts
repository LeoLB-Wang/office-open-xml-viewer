import { drawingMLGeometryBounds, GeometryWorkBudgetError, resolveDrawingMLGeometry } from '@silurus/ooxml-core';
import type { DrawingMLShapePaintPlan, GeometryPath } from '@silurus/ooxml-core';
import type { PathCmd, ShapeRun } from '../types.js';
import type { DeepReadonly, DrawingLayout, DrawingPaintCommand, LayoutRect } from './types.js';

type ShapeCommand = Extract<DrawingPaintCommand, { kind: 'drawingml-shape' }>;
type Point = readonly [number, number];

/** Effect ink can leave the source allocation box. Keep flow/wrap ownership
 * unchanged and enclose the retained shadow commands in the drawing's ink box,
 * including upright story transforms. No painter or text service is involved. */
export function shadowInkBounds(commands: readonly DrawingPaintCommand[], base: LayoutRect,
  owner?: DrawingLayout['transform']): LayoutRect {
  let left = base.xPt, top = base.yPt, right = left + base.widthPt, bottom = top + base.heightPt;
  const include = (x: number, y: number) => {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  };
  for (const command of commands) {
    if (command.kind === 'drawingml-shape') {
      const box = drawingMLGeometryBounds(command.plan, owner);
      if (box) { include(box.x, box.y); include(box.x + box.w, box.y + box.h); }
    } else if (command.kind === 'watermark-text') {
      const r = command.rect, cx = r.xPt + r.widthPt / 2, cy = r.yPt + r.heightPt / 2;
      const w = command.fitShape ? r.widthPt : command.sourceBounds.widthPt;
      const h = command.fitShape ? r.heightPt : command.sourceBounds.heightPt;
      const angle = command.rotationDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
      for (const [dx, dy] of [[0, 0], [w, 0], [w, h], [0, h]]) {
        const vx = r.xPt + dx - cx, vy = r.yPt + dy - cy;
        const x = cx + vx * cos - vy * sin, y = cy + vx * sin + vy * cos;
        include(owner ? owner.a * x + owner.c * y + owner.e : x,
          owner ? owner.b * x + owner.d * y + owner.f : y);
      }
    }
  }
  return { xPt: left, yPt: top, widthPt: right - left, heightPt: bottom - top };
}

/** Part 4 §19.1.2.18/§19.1.3.6: a single translated silhouette, two for
 * double/emboss, or a homogeneous perspective matrix about the shadow origin.
 * Acquisition owns all geometry; paint only replays ordinary shape commands.
 * Absolute offsets are points, fractions follow the final shape extent. */
export function planVmlShadows(
  shape: DeepReadonly<ShapeRun>, plan: DrawingMLShapePaintPlan,
  maximumWork = Infinity,
): readonly ShapeCommand[] {
  const shadow = shape.vmlShadow;
  if (!shadow || shadow.opacity === 0) return [];
  // Library resource policy: perspective subdivision can amplify a tiny
  // authored path. Bound acquired operations independently of source length.
  maximumWork = Math.min(maximumWork, 1_048_576);
  const { x, y, w, h } = plan.rect;
  let work = 0;
  const charge = (n = 1) => {
    work += n;
    if (work > maximumWork) throw new GeometryWorkBudgetError('VML shadow geometry allowance exceeded');
  };
  const retained: ShapeCommand[] = [];
  const offsets = shadow.kind === 'double' || shadow.kind === 'emboss'
    ? [[shadow.offset, shadow.color], [shadow.offset2, shadow.color2]] as const
    : [[shadow.offset, shadow.color]] as const;
  for (const [offset, color] of offsets) {
    const dx = offset.xPt + offset.xFraction * w, dy = offset.yPt + offset.yFraction * h;
    // The shadow uses its own solid pen. Omit the source brush entirely;
    // retained layout data cannot carry an explicit undefined property.
    const shadowStroke = plan.stroke ? { ...plan.stroke, color } : null;
    if (shadowStroke) delete shadowStroke.fill;
    let shadowPlan: DrawingMLShapePaintPlan = {
      ...plan, rect: { x: x + dx, y: y + dy, w, h },
      fill: !shadow.obscured || shape.fill || shape.vmlPicture ? { fillType: 'solid', color } : null,
      stroke: shadowStroke,
      resolvedGeometry: undefined,
    };
    if (shadow.kind === 'perspective') {
      const [sxx, sxy, syx, syy, px, py] = shadow.matrix;
      const ox = x + w * (0.5 + shadow.origin[0]), oy = y + h * (0.5 + shadow.origin[1]);
      const theta = plan.transform.rotationDeg * Math.PI / 180;
      const cos = Math.cos(theta), sin = Math.sin(theta);
      const project = (point: Point): Point => {
        charge();
        // MS-OI29500 §2.1.1807(c) places rotation/reflection before
        // the shadow matrix. Its row-vector convention maps x with sxx/syx
        // and y with sxy/syy. Matrix p values are reciprocal EMU (or reciprocal
        // extent fractions); use a homogeneous divisor in that unit domain.
        const vx0 = (point[0] - (x + w / 2)) * (plan.transform.flipH ? -1 : 1);
        const vy0 = (point[1] - (y + h / 2)) * (plan.transform.flipV ? -1 : 1);
        const vx = x + w / 2 + cos * vx0 - sin * vy0 - ox;
        const vy = y + h / 2 + sin * vx0 + cos * vy0 - oy;
        const z = 1 + (shadow.absolutePerspective ? 12700 * (px * vx + py * vy)
          : px * vx / (w || 1) + py * vy / (h || 1));
        if (z === 0 || !Number.isFinite(z)) throw new RangeError('VML shadow crosses the perspective horizon');
        return [ox + (sxx * vx + syx * vy + dx) / z, oy + (sxy * vx + syy * vy + dy) / z];
      };
      const geometry = plan.resolvedGeometry;
      if (!geometry) throw new Error('VML shadow requires acquired source geometry');
      const subpaths = geometry.paths.map(path => projectPath(path.path, project, charge));
      shadowPlan = {
        ...shadowPlan, rect: { x: 0, y: 0, w: 1, h: 1 },
        geometry: { kind: 'custom', subpaths, paint: geometry.paths.map(path => ({
          fillRule: path.fillRule,
          ...(path.fill === 'none' ? { fill: 'none' as const } : {}),
          ...(path.stroke ? {} : { stroke: false as const }),
        })) },
        transform: { rotationDeg: 0, flipH: false, flipV: false },
      };
    }
    const resolvedGeometry = resolveDrawingMLGeometry(shadowPlan, 1, maximumWork - work);
    charge(resolvedGeometry.workUnits);
    retained.push({ kind: 'drawingml-shape', shadowPass: true, plan: { ...shadowPlan, resolvedGeometry }, opacity: shadow.opacity });
  }
  return retained;
}

/** Canvas has no projective path transform. Flatten only perspective shadows,
 * to 1/1024pt in output space (numerical precision, independent of samples).
 * Lines project exactly. Curves subdivide adaptively; work is charged against
 * the caller's geometry allowance, with bounded recursion for singular input. */
export function projectPath(path: GeometryPath, project: (p: Point) => Point, charge: () => void): PathCmd[] {
  const out: PathCmd[] = [];
  let pen: Point = [0, 0], start: Point = pen;
  const move = (p: Point) => { const [x, y] = project(p); out.push({ cmd: 'moveTo', x, y }); pen = p; start = p; };
  const line = (p: Point) => { const [x, y] = project(p); out.push({ cmd: 'lineTo', x, y }); pen = p; };
  const curve = (at: (t: number) => Point) => {
    const subdivide = (a: number, b: number, pa: Point, pb: Point, depth: number): void => {
      charge();
      const samples = [0.25, 0.5, 0.75].map(f => project(at(a + (b - a) * f)));
      const error = Math.max(...samples.map((p, i) => {
        const f = (i + 1) / 4;
        return Math.hypot(p[0] - pa[0] - (pb[0] - pa[0]) * f, p[1] - pa[1] - (pb[1] - pa[1]) * f);
      }));
      if (error <= 1 / 1024) { out.push({ cmd: 'lineTo', x: pb[0], y: pb[1] }); return; }
      if (depth >= 24) throw new GeometryWorkBudgetError('VML perspective shadow cannot meet numerical precision');
      const mid = (a + b) / 2;
      subdivide(a, mid, pa, samples[1], depth + 1);
      subdivide(mid, b, samples[1], pb, depth + 1);
    };
    subdivide(0, 1, project(at(0)), project(at(1)), 0);
    pen = at(1);
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, rotation: number, a: number, b: number, ccw: boolean) => {
    let sweep = b - a;
    if (ccw && sweep > 0) sweep = sweep >= 2 * Math.PI ? -2 * Math.PI : sweep - 2 * Math.PI;
    if (!ccw && sweep < 0) sweep = sweep <= -2 * Math.PI ? 2 * Math.PI : sweep + 2 * Math.PI;
    const at = (t: number): Point => {
      const angle = a + sweep * t, vx = rx * Math.cos(angle), vy = ry * Math.sin(angle);
      return [cx + vx * Math.cos(rotation) - vy * Math.sin(rotation), cy + vx * Math.sin(rotation) + vy * Math.cos(rotation)];
    };
    line(at(0)); curve(at);
  };
  for (const { op, args: a } of path) {
    charge();
    switch (op) {
      case 'moveTo': move([a[0], a[1]]); break;
      case 'lineTo': line([a[0], a[1]]); break;
      case 'closePath': out.push({ cmd: 'close' }); pen = start; break;
      case 'quadraticCurveTo': {
        const p = pen;
        curve(t => { const s = 1 - t; return [s * s * p[0] + 2 * s * t * a[0] + t * t * a[2], s * s * p[1] + 2 * s * t * a[1] + t * t * a[3]]; }); break;
      }
      case 'bezierCurveTo': {
        const p = pen;
        curve(t => { const s = 1 - t; return [s ** 3 * p[0] + 3 * s * s * t * a[0] + 3 * s * t * t * a[2] + t ** 3 * a[4], s ** 3 * p[1] + 3 * s * s * t * a[1] + 3 * s * t * t * a[3] + t ** 3 * a[5]]; }); break;
      }
      case 'rect': move([a[0], a[1]]); line([a[0] + a[2], a[1]]); line([a[0] + a[2], a[1] + a[3]]); line([a[0], a[1] + a[3]]); out.push({ cmd: 'close' }); pen = start; break;
      case 'arc': ellipse(a[0], a[1], a[2], a[2], 0, a[3], a[4], !!a[5]); break;
      case 'ellipse': ellipse(a[0], a[1], a[2], a[3], a[4], a[5], a[6], !!a[7]); break;
      case 'roundRect': {
        const radii: Point[] = a[4] === 0
          ? Array.from({ length: 4 }, () => [a[5], a[5]] as const)
          : Array.from({ length: (a.length - 5) / 2 }, (_, i) => [a[5 + 2 * i], a[6 + 2 * i]] as const);
        const at = (i: number): Point => radii[i % radii.length];
        const tl = at(0), tr = radii.length === 1 ? tl : at(1);
        const br = radii.length === 2 ? tl : at(2), bl = radii.length === 1 ? tl : radii.length === 2 ? tr : radii.length === 3 ? tr : at(3);
        const left = a[0], top = a[1], right = left + a[2], bottom = top + a[3];
        const f = Math.min(1, a[2] / (tl[0] + tr[0] || 1), a[2] / (bl[0] + br[0] || 1), a[3] / (tl[1] + bl[1] || 1), a[3] / (tr[1] + br[1] || 1));
        const [lx, ly] = [tl[0] * f, tl[1] * f], [rx, ry] = [tr[0] * f, tr[1] * f];
        const [bx, by] = [br[0] * f, br[1] * f], [ex, ey] = [bl[0] * f, bl[1] * f];
        move([left + lx, top]); line([right - rx, top]); ellipse(right - rx, top + ry, rx, ry, 0, -Math.PI / 2, 0, false);
        line([right, bottom - by]); ellipse(right - bx, bottom - by, bx, by, 0, 0, Math.PI / 2, false);
        line([left + ex, bottom]); ellipse(left + ex, bottom - ey, ex, ey, 0, Math.PI / 2, Math.PI, false);
        line([left, top + ly]); ellipse(left + lx, top + ly, lx, ly, 0, Math.PI, 1.5 * Math.PI, false);
        out.push({ cmd: 'close' }); pen = start; break;
      }
    }
  }
  return out;
}
