import { describe, expect, it, vi } from 'vitest';

describe('optional reading runtime', () => {
  it('keeps ordinary normalization independent and acquires reading facts after source activation', async () => {
    vi.resetModules();
    const hooks = await import('./internal/reading-hooks.js');
    expect(hooks.readingHooks.wordBreaking(undefined)).toBeUndefined();
    expect(() => hooks.readingHooks.wordBreaking({ rawHres: 0, rawChHres: 1 })).toThrow();
    (await import('./internal/native-reading-runtime.js')).installNativeReadingRuntime();
    expect(hooks.readingHooks.wordBreaking({ rawHres: 0, rawChHres: 1 }))
      .toEqual({ rawHres: 0, rawChHres: 1 });
    expect(hooks.readingHooks.wordBreaking(undefined)).toBeUndefined();
  }, 30000);
});
