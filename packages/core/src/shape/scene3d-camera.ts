/**
 * DrawingML 3D camera — perspective projection of a planar shape (Phase A).
 *
 * ECMA-376 references:
 *   - §20.1.5.5  `camera` (CT_Camera): prst / fov / zoom / rot.
 *   - §20.1.5.11 `rot`    (CT_SphereCoords): lat / lon / rev rotation.
 *   - §20.1.10.47 ST_PresetCameraType: the 62 preset cameras.
 *
 * Fidelity boundary: ECMA-376 names presets and authored FOV/zoom/rotation,
 * but does not supply a numerical preset table or a complete projection matrix.
 * MS-OI29500 §2.1.1270 says non-perspective cameras ignore FOV. This module's
 * shape-local pinhole, rotation composition and incomplete orientation table are
 * legacy rendering approximations; they are not normative Office definitions.
 * See LEGACY_PERSP_FOV for the full-control evidence and accepted residuals.
 *
 * Phase A scope: we model the shape as a flat z=0 rectangle (the picture / 2D
 * drawing) and compute the 2D homography that maps the un-projected rectangle
 * to the projected quad. Bevel / extrusion / lightRig shading is Phase B.
 */

/**
 * Geometry-only camera inputs the projection math needs. Defined locally so the
 * core helper has no dependency on the pptx (or any format) type layer; the
 * pptx `Camera3d` / `Rot3d` are structurally assignable to these. Angles are in
 * degrees (the parser already converted from 60000ths).
 */
export interface CameraInput {
  /** Preset camera name (`ST_PresetCameraType`). */
  prst: string;
  /** Field-of-view override in degrees. Omitted = preset default. */
  fov?: number;
  /** Zoom factor as a unit ratio (1.0 = 100%). Omitted = 1.0. */
  zoom?: number;
  /** Camera rotation override. Omitted = preset base orientation. */
  rot?: RotInput;
}

/** Sphere-coordinate rotation in degrees — ECMA-376 §20.1.5.11. */
export interface RotInput {
  lat: number;
  lon: number;
  rev: number;
}

/** A 2D point in the projected (screen) plane, pixels relative to bbox origin. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Result of projecting a planar shape through the camera. */
export interface Scene3dQuad {
  /**
   * The four projected corners in CSS pixels, relative to the element's
   * bounding-box top-left, in order: top-left, top-right, bottom-right,
   * bottom-left (matching the source rectangle (0,0)-(w,0)-(w,h)-(0,h)).
   *
   * Projection is about the shape center and can extend beyond its original
   * box; zoom is retained. Callers must allow the projected bitmap to overhang.
   */
  corners: [Vec2, Vec2, Vec2, Vec2];
  /**
   * True when the projection is (numerically) an affine map — i.e. the four
   * corners still form a parallelogram. Orthographic / isometric presets and a
   * pure in-plane `rev` are affine; perspective presets with lat/lon tilt are
   * not. Callers can take a cheaper single-`setTransform` path when affine.
   */
  isAffine: boolean;
  /**
   * True when the projection is (numerically) the identity within the bbox —
   * the renderer should skip projection entirely and draw normally. Happens for
   * `orthographicFront` with no rot override (or rot all-zero).
   */
  isIdentity: boolean;
}

/** Preset camera kinds that determine the projection math. */
type ProjectionKind = 'perspective' | 'orthographic';

/**
 * Per-preset definition: the base camera orientation (replaced by an authored
 * `rot` override) and the fallback field of view in degrees for perspective
 * presets. Orthographic / isometric presets use parallel projection (fov is
 * ignored). The table is an incomplete library fallback, as documented above.
 *
 * Base orientation is expressed as the same lat/lon/rev sphere coordinates the
 * file uses, in degrees, so it composes with the user rot in one place.
 */
interface PresetDef {
  kind: ProjectionKind;
  /** Base latitude (X-axis tilt), degrees. */
  baseLat: number;
  /** Base longitude (Y-axis turn), degrees. */
  baseLon: number;
  /** Base revolution (Z-axis spin), degrees. */
  baseRev: number;
  /** Default field of view for perspective presets, degrees. */
  fovDeg: number;
}

// Retained legacy lens; NOT a measured per-preset FOV table.
// Windows PowerPoint 16.0 controls-auditc-camera/manifest.json covers all 62
// presets with omitted/zero/combined rotation, every perspective preset at FOV
// 5/15/26/45/75/115 degrees and three aspects/rotations, plus zoom and non-
// perspective FOV counterexamples (1,572 controls). Modern omitted-lens responses
// are near authored 45 degrees except the two heroic-extreme presets; legacy
// perspective also has an off-axis response. That is evidence AGAINST sharing
// one calibrated lens, not sufficient evidence for a complete camera model.
// Even the explicit-lens controls (which never use this default) disagree with
// the current framing: max corner error 451.57pt. Accepted maxima for presets,
// non-perspective FOV controls and zoom are 39.61/11.74/35.97pt respectively
// (conservative extraction uncertainty 0.75pt). No FOV-only refit can fix this.
// Keep the existing fallback until rotation, projection/framing, omitted preset
// orientation and physical size dependence can be identified together. The
// controls vary aspect but keep width fixed; an absolute camera distance cannot
// be inferred as scale-independent from them. Do not extrapolate a fitted table.
const LEGACY_PERSP_FOV = 26;

/**
 * Preset camera table. Only presets whose default orientation is implemented
 * are enumerated. Other standard `perspective*` presets still use perspective
 * projection when an authored `<a:rot>` supplies their orientation; unrelated
 * unknown/legacy presets fall back to `orthographicFront` without throwing.
 *
 * Library coordinate convention: +X right, +Y down, +Z toward the viewer.
 * Positive latitude tips the top toward the viewer, positive longitude turns
 * the right edge toward the viewer, and positive revolution spins counter-
 * clockwise. These are the implemented geometric conventions, not a claim that
 * the complete Office preset/rotation pipeline has been identified.
 */
const PRESETS: Record<string, PresetDef> = {
  // ---- Orthographic / front-facing ----
  orthographicFront: { kind: 'orthographic', baseLat: 0, baseLon: 0, baseRev: 0, fovDeg: 0 },

  // ---- Perspective family (front + heroic + relaxed) ----
  // perspectiveFront: looking straight on, but with perspective foreshortening.
  perspectiveFront: { kind: 'perspective', baseLat: 0, baseLon: 0, baseRev: 0, fovDeg: LEGACY_PERSP_FOV },
  // perspectiveRelaxed / perspectiveRelaxedModerately: a gentle downward tilt so
  // the top edge recedes. Their actual omitted orientations are not implemented;
  // retain the neutral fallback until the complete preset table is supported.
  perspectiveRelaxed: { kind: 'perspective', baseLat: 0, baseLon: 0, baseRev: 0, fovDeg: LEGACY_PERSP_FOV },
  perspectiveRelaxedModerately: { kind: 'perspective', baseLat: 0, baseLon: 0, baseRev: 0, fovDeg: LEGACY_PERSP_FOV },
  // perspectiveAbove / perspectiveBelow: camera looks down at / up at the shape.
  // "Above" → the top edge recedes, so lat < 0 in the file-angle convention
  // documented above (lat < 0 tips the top away); "Below" → top nears, lat > 0.
  perspectiveAbove: { kind: 'perspective', baseLat: -20, baseLon: 0, baseRev: 0, fovDeg: LEGACY_PERSP_FOV },
  perspectiveBelow: { kind: 'perspective', baseLat: 20, baseLon: 0, baseRev: 0, fovDeg: LEGACY_PERSP_FOV },
  // Left / right facing perspective variants: shape turned about the Y axis.
  // "Right" shows the right edge nearer (lon > 0); "Left" the left edge nearer
  // (lon < 0). These ±20-degree fallback tilts are not the measured Office table.
  perspectiveLeft: { kind: 'perspective', baseLat: 0, baseLon: -20, baseRev: 0, fovDeg: LEGACY_PERSP_FOV },
  perspectiveRight: { kind: 'perspective', baseLat: 0, baseLon: 20, baseRev: 0, fovDeg: LEGACY_PERSP_FOV },
};

/** Relaxed omitted orientations remain neutral as a library fallback, not a
 * specification default. Explicit rot supplies the modeled orientation. */

/** 3×3 matrix in row-major order. */
type Mat3 = [number, number, number, number, number, number, number, number, number];

function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as number[];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
      r[i * 3 + j] = s;
    }
  }
  return r as Mat3;
}

function rotX(deg: number): Mat3 {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  // X-axis rotation (latitude tilt).
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

function rotY(deg: number): Mat3 {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  // Y-axis rotation (longitude turn).
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

function rotZ(deg: number): Mat3 {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  // Z-axis rotation (revolution / in-plane spin).
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function applyMat3(m: Mat3, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

/**
 * Legacy object rotation Rz(-rev) · Rx(-lat) · Ry(-lon), with explicit rot
 * replacing the modeled preset orientation. ECMA-376 §§20.1.5.5/.11 describe
 * rotation overrides but do not establish this entire matrix. Keep it stable
 * while the full camera response, rather than a FOV-only fit, is unresolved.
 */
function buildRotation(preset: PresetDef, rot: RotInput | undefined): Mat3 {
  const lat = rot ? rot.lat : preset.baseLat;
  const lon = rot ? rot.lon : preset.baseLon;
  const rev = rot ? rot.rev : preset.baseRev;
  return mul3(rotZ(-rev), mul3(rotX(-lat), rotY(-lon)));
}

/** Look up a preset while retaining the projection family encoded by its
 * standard name. An explicit `<a:rot>` replaces the missing preset orientation,
 * so the perspectiveFront lens is the neutral fallback for that family. */
function presetDef(prst: string): PresetDef {
  const known = PRESETS[prst];
  if (known) return known;
  if (prst.startsWith('perspective')) return PRESETS.perspectiveFront;
  return PRESETS.orthographicFront;
}

/**
 * Project a planar shape (the w×h rectangle) through the camera and return the
 * four projected corners in shape-local coordinates. A tilted camera can
 * legitimately project outside the original 2-D box; forcing it back into
 * that box would cancel camera zoom and shrink the authored 3-D scene.
 *
 * @param camera  parsed <a:camera> (prst / fov / zoom / rot, angles in degrees).
 * @param w       shape width in CSS pixels.
 * @param h       shape height in CSS pixels.
 */
export function computeScene3dQuad(camera: CameraInput, w: number, h: number): Scene3dQuad {
  const def = presetDef(camera.prst);
  const R = buildRotation(def, camera.rot);

  // Degenerate sizes can't be projected meaningfully.
  if (w <= 0 || h <= 0) {
    return {
      corners: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
      isAffine: true,
      isIdentity: true,
    };
  }

  // Source rectangle corners centred at the origin in shape-local space, with
  // +X right, +Y down. We work in a unit-ish space (half-extents) so the FOV /
  // camera distance is independent of pixel size, then rescale at the end.
  const hw = w / 2;
  const hh = h / 2;
  const srcCorners: Array<[number, number]> = [
    [-hw, -hh], // top-left
    [hw, -hh], // top-right
    [hw, hh], // bottom-right
    [-hw, hh], // bottom-left
  ];

  const zoom = camera.zoom ?? 1;

  // Camera distance for perspective. The shape's larger half-extent subtends
  // the full field of view at the camera plane: d = halfMax / tan(fov/2). This
  // is a standard pinhole relation and our shape-local framing policy, not the
  // Office framing rule (see the explicit-lens residuals above).
  const halfMax = Math.max(hw, hh);
  let projected: Array<[number, number]>;

  if (def.kind === 'perspective') {
    const fovDeg = camera.fov ?? def.fovDeg;
    const fov = (Math.max(1, Math.min(179, fovDeg)) * Math.PI) / 180;
    const d = halfMax / Math.tan(fov / 2);
    projected = srcCorners.map(([sx, sy]) => {
      const [rx, ry, rz] = applyMat3(R, sx, sy, 0);
      // Camera at +Z = d looking toward -Z (origin). A point at object-z rz is
      // at camera-relative depth (d - rz); perspective divide by that depth.
      const depth = d - rz;
      // Guard against a corner crossing the camera plane (shouldn't happen for
      // sane tilts, but clamp to keep the map finite).
      const safeDepth = Math.abs(depth) < 1e-6 ? 1e-6 * Math.sign(depth || 1) : depth;
      const f = d / safeDepth;
      return [rx * f, ry * f] as [number, number];
    });
  } else {
    // Parallel (orthographic / isometric) projection: drop z after rotation.
    projected = srcCorners.map(([sx, sy]) => {
      const [rx, ry] = applyMat3(R, sx, sy, 0);
      return [rx, ry] as [number, number];
    });
  }

  // Apply zoom about the centre.
  projected = projected.map(([px, py]) => [px * zoom, py * zoom] as [number, number]);

  const corners = projected.map(([px, py]) => ({
    x: w / 2 + px,
    y: h / 2 + py,
  })) as [Vec2, Vec2, Vec2, Vec2];

  // Affine test: a quad is a parallelogram iff (C0 + C2) == (C1 + C3) (the
  // diagonals bisect). Use a relative epsilon vs. the bbox size.
  const eps = 1e-3 * Math.max(w, h);
  const sumDiagX = corners[0].x + corners[2].x - (corners[1].x + corners[3].x);
  const sumDiagY = corners[0].y + corners[2].y - (corners[1].y + corners[3].y);
  const isAffine = Math.abs(sumDiagX) < eps && Math.abs(sumDiagY) < eps;

  // Identity test: corners within epsilon of the un-projected rectangle.
  const ref: Array<[number, number]> = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  let isIdentity = true;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(corners[i].x - ref[i][0]) > eps || Math.abs(corners[i].y - ref[i][1]) > eps) {
      isIdentity = false;
      break;
    }
  }

  return { corners, isAffine, isIdentity };
}

/**
 * True when a scene3d camera will visibly change the shape, i.e. the renderer
 * should take the projection path. A camera whose preset is unknown/front-facing
 * with no rot (or an all-zero rot) is the identity and can be skipped.
 */
export function isScene3dNonIdentity(camera: CameraInput): boolean {
  // A 1×1 probe is enough to detect identity vs. projection; the result scales.
  const { isIdentity } = computeScene3dQuad(camera, 1000, 1000);
  return !isIdentity;
}

/**
 * Screen-space displacement (in shape-local px, +X right / +Y down) of pushing a
 * point at the shape centre by `depthPx` along the object's −Z axis (i.e. AWAY
 * from the viewer — the direction an extrusion's back face sits). Used by the
 * extrusion renderer to offset the swept side-wall band (§20.1.5.12 extrusionH).
 *
 * For a face-on camera (orthographicFront / perspectiveFront with no rot) the
 * −Z axis projects straight back into the screen, so the screen displacement is
 * ~0 and the side walls are (correctly) invisible. A tilted/rotated camera turns
 * −Z partly into the screen plane, revealing the side wall as this offset.
 *
 * This is the LINEARISED offset of the box centre; for a perspective camera the
 * exact side-wall outline is a frustum sweep that varies per silhouette point.
 * Phase B uses this single centre offset as the documented approximation (good
 * for small extrusions / gentle tilts; see the renderer's extrusion note).
 */
export function computeDepthOffset(camera: CameraInput, w: number, h: number, depthPx: number): Vec2 {
  const def = presetDef(camera.prst);
  const R = buildRotation(def, camera.rot);
  if (w <= 0 || h <= 0 || depthPx === 0) return { x: 0, y: 0 };

  const hw = w / 2;
  const hh = h / 2;
  const halfMax = Math.max(hw, hh);
  const zoom = camera.zoom ?? 1;

  // Project the centre at object-z 0 and at object-z −depthPx, take the screen
  // delta. Mirrors the per-corner math in computeScene3dQuad (same rotation,
  // same perspective divide), but without the box refit — we only need the
  // direction/scale of the displacement, which the caller applies in the
  // refitted offscreen space (a close approximation for small depths).
  const project = (oz: number): [number, number] => {
    const [rx, ry, rz] = applyMat3(R, 0, 0, oz);
    if (def.kind === 'perspective') {
      const fovDeg = camera.fov ?? def.fovDeg;
      const fov = (Math.max(1, Math.min(179, fovDeg)) * Math.PI) / 180;
      const d = halfMax / Math.tan(fov / 2);
      const depth = d - rz;
      const safe = Math.abs(depth) < 1e-6 ? 1e-6 * Math.sign(depth || 1) : depth;
      const f = d / safe;
      return [rx * f * zoom, ry * f * zoom];
    }
    return [rx * zoom, ry * zoom];
  };
  const [x0, y0] = project(0);
  const [x1, y1] = project(-depthPx);
  return { x: x1 - x0, y: y1 - y0 };
}
