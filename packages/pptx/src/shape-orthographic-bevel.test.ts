import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBevelInputs, renderSlide } from './renderer.js';
import type { ShapeElement, Slide } from './types.js';

function contextFor(canvas: { width: number; height: number }, drawImages?: unknown[][]): CanvasRenderingContext2D {
  const state: Record<string, unknown> = {
    canvas,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    measureText: (text: string) => ({ width: text.length * 6 }),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    }),
    drawImage: (...args: unknown[]) => drawImages?.push(args),
  };
  return new Proxy(state, {
    get(target, property, receiver) {
      if (property in target) return Reflect.get(target, property, receiver);
      return () => undefined;
    },
    set(target, property, value, receiver) {
      return Reflect.set(target, property, value, receiver);
    },
  }) as unknown as CanvasRenderingContext2D;
}

class TestOffscreenCanvas {
  width: number;
  height: number;
  readonly context: CanvasRenderingContext2D;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = contextFor(this);
  }

  getContext(): CanvasRenderingContext2D {
    return this.context;
  }
}

function orthographicBeveledShape(): ShapeElement {
  return {
    type: 'shape',
    x: 914_400,
    y: 914_400,
    width: 914_400,
    height: 914_400,
    rotation: 0,
    flipH: false,
    flipV: false,
    geometry: 'roundRect',
    fill: { fillType: 'solid', color: '4472C4' },
    stroke: null,
    textBody: null,
    defaultTextColor: null,
    custGeom: null,
    adj: null,
    adj2: null,
    adj3: null,
    adj4: null,
    adj5: null,
    adj6: null,
    adj7: null,
    adj8: null,
    shadow: null,
    scene3d: {
      camera: { prst: 'orthographicFront' },
      lightRig: { rig: 'chilly', dir: 't' },
    },
    sp3d: {
      prstMaterial: 'translucentPowder',
      bevelT: { w: 127_000, h: 25_400, prst: 'softRound' },
    },
  };
}

function projectedBeveledShape(): ShapeElement {
  const shape = orthographicBeveledShape();
  return {
    ...shape,
    scene3d: {
      camera: { prst: 'isometricLeftUp' },
      lightRig: { rig: 'chilly', dir: 't' },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shape orthographic bevel', () => {
  it('passes authored latitude and longitude into both bevel faces', () => {
    const [top, bottom] = buildBevelInputs({
      bevelT: { w: 10, h: 5, prst: 'circle' },
      bevelB: { w: 10, h: 5, prst: 'circle' },
    }, { rig: 'threePt', dir: 't', rot: { lat: 90, lon: 90, rev: 90 } }, 'matte', 1, 1);
    const [base] = buildBevelInputs({ bevelT: { w: 10, h: 5, prst: 'circle' } },
      { rig: 'threePt', dir: 't' }, 'matte', 1, 1);
    // Independent quarter-turn axis exchange also checks the parser-model
    // angles survive the production bevel-input boundary.
    expect(top.light.x).toBeCloseTo(0);
    expect(top.light.y).toBeCloseTo(-base.light.z);
    expect(top.light.z).toBeCloseTo(base.light.y);
    expect(bottom.light).toEqual(top.light);
    expect(top.fillLight?.y).toBeCloseTo(-(base.fillLight?.z as number));
    expect(bottom.fillLight).toEqual(top.fillLight);
  });

  it('renders an identity-camera bevel through an offscreen shaded face', async () => {
    const created: TestOffscreenCanvas[] = [];
    vi.stubGlobal('OffscreenCanvas', class extends TestOffscreenCanvas {
      constructor(width: number, height: number) {
        super(width, height);
        created.push(this);
      }
    });

    const drawImages: unknown[][] = [];
    const canvas = {
      width: 960,
      height: 540,
      style: {} as CSSStyleDeclaration,
      offsetWidth: 960,
    } as HTMLCanvasElement;
    const ctx = contextFor(canvas, drawImages);
    canvas.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
    const slide: Slide = {
      index: 0,
      slideNumber: 1,
      background: null,
      elements: [orthographicBeveledShape()],
    };

    await renderSlide(canvas, slide, 9_144_000, 6_858_000, { width: 960, dpr: 1 });

    expect(created).toHaveLength(1);
    expect(drawImages).toHaveLength(1);
    expect(drawImages[0]?.[0]).toBe(created[0]);
  });

  it('applies a projected bevel once instead of shading the recursive flat body', async () => {
    const created: TestOffscreenCanvas[] = [];
    vi.stubGlobal('OffscreenCanvas', class extends TestOffscreenCanvas {
      constructor(width: number, height: number) {
        super(width, height);
        created.push(this);
      }
    });

    const canvas = {
      width: 960,
      height: 540,
      style: {} as CSSStyleDeclaration,
      offsetWidth: 960,
    } as HTMLCanvasElement;
    const ctx = contextFor(canvas);
    canvas.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
    const slide: Slide = {
      index: 0,
      slideNumber: 1,
      background: null,
      elements: [projectedBeveledShape()],
    };

    await renderSlide(canvas, slide, 9_144_000, 6_858_000, { width: 960, dpr: 1 });

    expect(created).toHaveLength(1);
  });
});
