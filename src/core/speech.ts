export interface SpeechProvider {
  setVolume(value: number): void;
  getVolume(): number;
}

export type PcmAudio = {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
};

export interface SampleSpeechProvider extends SpeechProvider {
  synthesize(text: string, onProgress?: (loaded: number, total: number) => void): Promise<PcmAudio>;
}

export function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export class BrowserSpeechProvider implements SpeechProvider {
  private volume = 1;

  setVolume(value: number): void { this.volume = clampVolume(value); }
  getVolume(): number { return this.volume; }

  createUtterance(text: string, rate = 1): SpeechSynthesisUtterance {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.volume = this.volume;
    return utterance;
  }
}

/** Shared by audio providers: ramp gain changes to avoid audible clicks. */
export class GainNodeSpeechProvider implements SpeechProvider {
  constructor(private readonly gain: GainNode, private readonly context: AudioContext) {}

  setVolume(value: number): void {
    const target = clampVolume(value);
    this.gain.gain.cancelScheduledValues(this.context.currentTime);
    this.gain.gain.setTargetAtTime(target, this.context.currentTime, 0.015);
  }

  getVolume(): number { return this.gain.gain.value; }
}
