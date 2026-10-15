export type NativeReadingSceneBlocker =
  | 'source-ownership' | 'member-coverage' | 'geometry' | 'resource'
  | 'owned-text' | 'clip' | 'paint' | 'budget' | 'placement';

export class NativeReadingSceneError extends Error {
  readonly blocker: NativeReadingSceneBlocker;
  constructor(blocker: NativeReadingSceneBlocker, message: string) {
    super(`Native reading scene ${blocker}: ${message}`);
    this.name = 'NativeReadingSceneError';
    this.blocker = blocker;
  }
}
