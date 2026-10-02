let cancelActiveExport: (() => Promise<void>) | undefined;
const generatedAudioCleanups = new Set<() => void>();

export function registerActiveExport(cancel: () => Promise<void>): () => void {
  cancelActiveExport = cancel;
  return () => {
    if (cancelActiveExport === cancel) cancelActiveExport = undefined;
  };
}

export async function cancelRegisteredExport(): Promise<void> {
  await cancelActiveExport?.();
}

export function registerGeneratedAudioCleanup(cleanup: () => void): () => void {
  generatedAudioCleanups.add(cleanup);
  return () => generatedAudioCleanups.delete(cleanup);
}

export function clearRegisteredGeneratedAudio(): void {
  for (const cleanup of generatedAudioCleanups) cleanup();
}
