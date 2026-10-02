import { describe, expect, it, vi } from 'vitest';
import { synthesizeWithRecovery } from './audioSynthesis';
import type { PcmAudio } from './speech';

const sampleRate = 22_050;
const audio = (value: number): PcmAudio => ({
  samples: new Float32Array([value, value]),
  sampleRate,
  channels: 1,
});

describe('resilient audiobook synthesis', () => {
  it('retries a failing chunk as sanitized sentences and substitutes silence only for failed sentences', async () => {
    const synthesize = vi
      .fn<(text: string) => Promise<PcmAudio>>()
      .mockRejectedValueOnce(new Error('Gather node bounds failure'))
      .mockResolvedValueOnce(audio(0.25))
      .mockRejectedValueOnce(new Error('sentence failed'))
      .mockResolvedValueOnce(audio(0.5));
    const result = await synthesizeWithRecovery(
      { synthesize },
      'Keep this. Skip this. Keep going.',
      sampleRate,
      4,
    );

    expect(synthesize).toHaveBeenCalledTimes(4);
    expect(result.skippedSentenceIndexes).toEqual([5]);
    expect(result.audio.samples.length).toBeGreaterThan(2 + Math.round(sampleRate * 0.35));
    expect(result.audio.samples).toContain(0);
    expect(result.audio.samples).toContain(0.25);
    expect(result.audio.samples).toContain(0.5);
  });

  it('does not retry fatal memory errors or cancellations', async () => {
    const synthesize = vi.fn<(text: string) => Promise<PcmAudio>>().mockRejectedValue(
      new RangeError('Out of memory'),
    );
    await expect(synthesizeWithRecovery({ synthesize }, 'One sentence.', sampleRate)).rejects.toThrow(
      /memory/iu,
    );
    expect(synthesize).toHaveBeenCalledTimes(1);
  });
});
