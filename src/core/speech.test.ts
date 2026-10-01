import { describe, expect, it, vi } from 'vitest';
import { BrowserSpeechProvider, clampVolume, GainNodeSpeechProvider } from './speech';

describe('speech volume providers', () => {
  it('clamps browser speech volume and applies it to every newly created utterance', () => {
    class MockUtterance { volume = 1; rate = 1; constructor(public text: string) {} }
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
    const provider = new BrowserSpeechProvider();
    provider.setVolume(0.62);
    expect(provider.getVolume()).toBe(0.62);
    expect(provider.createUtterance('first').volume).toBe(0.62);
    provider.setVolume(3);
    expect(provider.getVolume()).toBe(1);
    expect(provider.createUtterance('next chunk').volume).toBe(1);
    provider.setVolume(-1);
    expect(provider.createUtterance('muted').volume).toBe(0);
    vi.unstubAllGlobals();
  });

  it('ramps gain and clamps audio provider volume', () => {
    const setTargetAtTime = vi.fn();
    const cancelScheduledValues = vi.fn();
    const gain = { gain: { value: 0.7, setTargetAtTime, cancelScheduledValues } } as unknown as GainNode;
    const context = { currentTime: 12 } as AudioContext;
    const provider = new GainNodeSpeechProvider(gain, context);
    provider.setVolume(0.4);
    expect(cancelScheduledValues).toHaveBeenCalledWith(12);
    expect(setTargetAtTime).toHaveBeenCalledWith(0.4, 12, 0.015);
    provider.setVolume(Number.NaN);
    expect(setTargetAtTime).toHaveBeenLastCalledWith(0, 12, 0.015);
    expect(clampVolume(2)).toBe(1);
  });
});
