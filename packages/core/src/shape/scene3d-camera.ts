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
 * modern preset table and projection are bounded Office observations, not
 * normative definitions. Legacy presets retain their previous parallel fallback.
 * See MODERN_DISTANCE_PER_WIDTH for the evidence and scene-scale limitation.
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
 * ignored). Modern oblique presets additionally shear the rotated depth.
 *
 * Base orientation is expressed as the same lat/lon/rev sphere coordinates the
 * file uses, in degrees; authored rot replaces it.
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
  /** Perspective distance numerator per unit of shape width; absent = old fallback. */
  distancePerWidth?: number;
  /** Parallel depth shear in screen coordinates, after rotation. */
  shearX: number;
  shearY: number;
}

// Observed Office behavior (Windows PowerPoint 16.0, synthetic flat rectangles):
// all 44 modern ST_PresetCameraType values (20 isometric, 8 oblique, 15
// perspective, orthographicFront) were checked with omitted/zero/(25,35,17)
// rotations. All 15 perspective names also cover FOV 5/15/26/45/75/115 degrees,
// rotations (0,30,0)/(30,0,0)/(25,35,17), aspects 0.7/1.5/2.5; zoom controls
// cover 0.5/1/1.5. Max modern corner residuals by preset/lens/parallel-FOV/zoom
// stratum: 0.688/0.556/0.496/0.503pt (0.75pt PDF extraction uncertainty).
// The table's orientation hypothesis was independently checked against those
// Office controls; the numeric angles are observations, not ECMA defaults.
//
// The measured perspective law is d=452.16pt/tan(FOV/2) at width 95.76pt.
// Microsoft Open Specifications support, question 769795 (2022-03-23), gives
// d=6.28/tan(FOV/2) in SCENE units, leaving document-unit mapping unspecified.
// Since all controls use one width, fixed physical distance and width-relative
// distance are indistinguishable. Library scale policy: use the width-relative
// law below so CSS/device-space projection and extrusion remain covariant.
// This is NOT a measured physical-size law or a claim that a scene unit is an
// inch. Vary physical width to settle that mapping before claiming size fidelity.
// The omitted lenses (45 degrees, 80 for both heroic-extreme presets) and 0.3
// directional oblique shear fit this bounded packet. Arbitrary rotations,
// physical sizes, groups, extrusion and near-plane behavior are not validated.
const MODERN_DISTANCE_PER_WIDTH = 452.16 / 95.76;

// Legacy ST_PresetCameraType names intentionally keep the previous parallel
// fallback, including their authored rotations/FOV handling; no legacy framing
// candidate is adopted. In the same 1,572-control investigation, an off-axis
// perspective candidate still missed by 41.425pt; 73 cases exceeded 2pt, all
// legacy perspective. The 3.037pt preset and 4.232pt zoom maxima were legacy,
// not modern failures. A free scale per case hid the error but supplied no rule.
// Audit C camera-round2-residuals.json (local investigation evidence) retains
// every control and the per-case/preset/stratum residual table. Legacy oblique
// shear and legacy perspective framing remain explicit fidelity limitations.
// Retained legacy production maxima by preset/lens/zoom: 24.023/65.689/35.969pt;
// these are unresolved errors, not accepted tolerances.
// Keep the old 26-degree lens only for the unrecognized perspective* fallback;
// no measured modern preset uses it. These fallbacks are library policy.
const LEGACY_PERSP_FOV = 26;

function parallel(lat = 0, lon = 0, rev = 0, shearX = 0, shearY = 0): PresetDef {
  return { kind: 'orthographic', baseLat: lat, baseLon: lon, baseRev: rev, fovDeg: 0, shearX, shearY };
}

function perspective(lat: number, lon: number, rev: number, fovDeg = 45): PresetDef {
  return {
    kind: 'perspective', baseLat: lat, baseLon: lon, baseRev: rev, fovDeg,
    distancePerWidth: MODERN_DISTANCE_PER_WIDTH, shearX: 0, shearY: 0,
  };
}

/**
 * ECMA-376 §20.1.10.47 names these modern presets; numerical definitions below
 * are the bounded Office observations above. +X right, +Y down, +Z toward viewer.
 * Explicit rot replaces these angles, retaining the preset's projection/shear.
 */
const PRESETS: Record<string, PresetDef> = {
  isometricBottomDown: parallel(35.4, 314.7, 299.8),
  isometricBottomUp: parallel(35.4, 45.3, 60.2),
  isometricLeftDown: parallel(35, 45, 0),
  isometricLeftUp: parallel(325, 45, 0),
  isometricOffAxis1Left: parallel(18, 64, 0),
  isometricOffAxis1Right: parallel(18, 334, 0),
  isometricOffAxis1Top: parallel(301.3, 306.5, 57.6),
  isometricOffAxis2Left: parallel(18, 26, 0),
  isometricOffAxis2Right: parallel(18, 296, 0),
  isometricOffAxis2Top: parallel(301.3, 53.5, 302.4),
  isometricOffAxis3Bottom: parallel(58.7, 306.5, 302.4),
  isometricOffAxis3Left: parallel(342, 64, 0),
  isometricOffAxis3Right: parallel(342, 334, 0),
  isometricOffAxis4Bottom: parallel(58.7, 53.5, 57.6),
  isometricOffAxis4Left: parallel(342, 26, 0),
  isometricOffAxis4Right: parallel(342, 296, 0),
  isometricRightDown: parallel(325, 315, 0),
  isometricRightUp: parallel(35, 315, 0),
  isometricTopDown: parallel(324.6, 45.3, 299.8),
  isometricTopUp: parallel(324.6, 314.7, 60.2),
  obliqueBottom: parallel(0, 0, 0, 0, -0.3),
  obliqueBottomLeft: parallel(0, 0, 0, 0.3 / Math.sqrt(2), -0.3 / Math.sqrt(2)),
  obliqueBottomRight: parallel(0, 0, 0, -0.3 / Math.sqrt(2), -0.3 / Math.sqrt(2)),
  obliqueLeft: parallel(0, 0, 0, 0.3, 0),
  obliqueRight: parallel(0, 0, 0, -0.3, 0),
  obliqueTop: parallel(0, 0, 0, 0, 0.3),
  obliqueTopLeft: parallel(0, 0, 0, 0.3 / Math.sqrt(2), 0.3 / Math.sqrt(2)),
  obliqueTopRight: parallel(0, 0, 0, -0.3 / Math.sqrt(2), 0.3 / Math.sqrt(2)),
  orthographicFront: parallel(0, 0, 0),
  perspectiveAbove: perspective(340, 0, 0),
  perspectiveAboveLeftFacing: perspective(39.3, 14.3, 341.1),
  perspectiveAboveRightFacing: perspective(39.3, 345.7, 18.9),
  perspectiveBelow: perspective(20, 0, 0),
  perspectiveContrastingLeftFacing: perspective(10.4, 43.9, 356.4),
  perspectiveContrastingRightFacing: perspective(10.4, 316.1, 3.6),
  perspectiveFront: perspective(0, 0, 0),
  perspectiveHeroicExtremeLeftFacing: perspective(8.1, 34.5, 357.1, 80),
  perspectiveHeroicExtremeRightFacing: perspective(8.1, 325.5, 2.9, 80),
  perspectiveHeroicLeftFacing: perspective(349, 14.3, 2.6),
  perspectiveHeroicRightFacing: perspective(349, 345.7, 357.4),
  perspectiveLeft: perspective(0, 20, 0),
  perspectiveRelaxed: perspective(309.6, 0, 0),
  perspectiveRelaxedModerately: perspective(324.8, 0, 0),
  perspectiveRight: perspective(0, 340, 0),
};

const UNKNOWN_PERSPECTIVE: PresetDef = {
  ...perspective(0, 0, 0, LEGACY_PERSP_FOV), distancePerWidth: undefined,
};

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
 * Object rotation Rz(-rev) · Rx(-lat) · Ry(-lon), with explicit rot replacing
 * the modeled preset orientation. ECMA-376 §§20.1.5.5/.11 describe overrides;
 * the modern-camera controls above support this matrix for their tested angles.
 * It is not a complete legacy camera model (legacy perspective ignores rev).
 */
function buildRotation(preset: PresetDef, rot: RotInput | undefined): Mat3 {
  const lat = rot ? rot.lat : preset.baseLat;
  const lon = rot ? rot.lon : preset.baseLon;
  const rev = rot ? rot.rev : preset.baseRev;
  return mul3(rotZ(-rev), mul3(rotX(-lat), rotY(-lon)));
}

/** Look up a preset while retaining the projection family encoded by its
 * standard name. Unknown perspective names retain the old neutral lens/framing;
 * other unknown and legacy names retain the old parallel fallback. */
function presetDef(prst: string): PresetDef {
  const known = PRESETS[prst];
  if (known) return known;
  if (prst.startsWith('perspective')) return UNKNOWN_PERSPECTIVE;
  return PRESETS.orthographicFront;
}

/** Shared by the face and extrusion so their coordinate scales agree. */
function cameraDistance(camera: CameraInput, def: PresetDef, w: number, h: number): number {
  const fovDeg = camera.fov ?? def.fovDeg;
  // Retain the finite-lens guard; endpoint/near-plane fidelity is unvalidated.
  const fov = (Math.max(1, Math.min(179, fovDeg)) * Math.PI) / 180;
  const numerator = def.distancePerWidth === undefined ? Math.max(w, h) / 2 : w * def.distancePerWidth;
  return numerator / Math.tan(fov / 2);
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
 * @param surfaceDepth back surface distance along object −Z, in the same units.
 *                MS-OI29500 §2.1.1268 places bevelB at the extrusion base.
 */
export function computeScene3dQuad(camera: CameraInput, w: number, h: number, surfaceDepth = 0): Scene3dQuad {
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

  // Source corners centred at the origin, in the caller's coordinate units.
  const hw = w / 2;
  const hh = h / 2;
  const srcCorners: Array<[number, number]> = [
    [-hw, -hh], // top-left
    [hw, -hh], // top-right
    [hw, hh], // bottom-right
    [-hw, hh], // bottom-left
  ];

  const zoom = camera.zoom ?? 1;

  let projected: Array<[number, number]>;

  if (def.kind === 'perspective') {
    const d = cameraDistance(camera, def, w, h);
    projected = srcCorners.map(([sx, sy]) => {
      const [rx, ry, rz] = applyMat3(R, sx, sy, -surfaceDepth);
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
    // Parallel projection, including the oblique preset's directional depth shear.
    projected = srcCorners.map(([sx, sy]) => {
      const [rx, ry, rz] = applyMat3(R, sx, sy, -surfaceDepth);
      return [rx + rz * def.shearX, ry + rz * def.shearY] as [number, number];
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
 * with no rot (or an all-zero rot) can be skipped only if its depth geometry
 * is also unchanged. `depth` uses the same coordinate units as w and h.
 */
export function isScene3dNonIdentity(camera: CameraInput, w?: number, h?: number, depth = 0): boolean {
  // Perspective framing depends on aspect, so a square probe can miss a visible
  // projection on a tall shape. Renderers supply their actual dimensions.
  if (w !== undefined && h !== undefined) {
    // The front plane alone is insufficient: default oblique cameras preserve
    // it but shear the extrusion base (§20.1.5.12). Test both ends of the solid
    // with the same geometry tolerance; this also retains perspective depth.
    return !computeScene3dQuad(camera, w, h).isIdentity ||
      (depth > 0 && !computeScene3dQuad(camera, w, h, depth).isIdentity);
  }
  // Geometry-free callers use a conservative mathematical identity test instead
  // of borrowing a shape's numerical pixel tolerance.
  const def = presetDef(camera.prst), R = buildRotation(def, camera.rot);
  const terms = def.kind === 'perspective'
    ? [R[0] - 1, R[1], R[3], R[4] - 1, R[6], R[7]]
    : [R[0] + def.shearX * R[6] - 1, R[1] + def.shearX * R[7],
       R[3] + def.shearY * R[6], R[4] + def.shearY * R[7] - 1];
  if (depth > 0) {
    if (def.kind === 'perspective') return true;
    terms.push(R[2] + def.shearX * R[8], R[5] + def.shearY * R[8]);
  }
  return (camera.zoom ?? 1) !== 1 || terms.some(value => Math.abs(value) > 1e-12);
}

/** Internal surface frame for the bitmap bevel compositor. Back-face selection
 * uses the camera's viewing direction (including parallel oblique shear), not
 * a rotation-angle threshold. ECMA §§20.1.5.3–4 assign separate back/front faces.
 */
export function scene3dSurfaceFrame(camera: CameraInput) {
  const def = presetDef(camera.prst), rotation = buildRotation(def, camera.rot);
  const facing = rotation[8] - def.shearX * rotation[2] - def.shearY * rotation[5];
  return { rotation, backFacing: facing < 0 };
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

  const zoom = camera.zoom ?? 1;

  // Project the centre at object-z 0 and at object-z −depthPx, take the screen
  // delta. Use the same lens, distance and parallel shear as the front face.
  // Width-relative distance also keeps device-space extrusion consistent with
  // the CSS-space quad. This remains a centre approximation to the wall sweep.
  const project = (oz: number): [number, number] => {
    const [rx, ry, rz] = applyMat3(R, 0, 0, oz);
    if (def.kind === 'perspective') {
      const d = cameraDistance(camera, def, w, h);
      const depth = d - rz;
      const safe = Math.abs(depth) < 1e-6 ? 1e-6 * Math.sign(depth || 1) : depth;
      const f = d / safe;
      return [rx * f * zoom, ry * f * zoom];
    }
    return [(rx + rz * def.shearX) * zoom, (ry + rz * def.shearY) * zoom];
  };
  const [x0, y0] = project(0);
  const [x1, y1] = project(-depthPx);
  return { x: x1 - x0, y: y1 - y0 };
}
