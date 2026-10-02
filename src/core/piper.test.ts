import { describe, expect, it, vi } from 'vitest';
import {
  piperLengthScale,
  decodePiperWav,
  pinnedPiperModelUrl,
  filterPiperPhonemeIds,
  PiperSpeechProvider,
  PIPER_VOICE,
  sanitizeSpeechInput,
  type PiperWorkerPort,
  type PiperWorkerRequest,
  type PiperWorkerResponse,
} from './piper';

function makePcmWav(samples: number[], sampleRate = 22_050): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const tag = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };
  tag(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return buffer;
}

class MockPiperWorker implements PiperWorkerPort {
  onmessage: ((event: MessageEvent<PiperWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: PiperWorkerRequest[] = [];
  terminated = false;

  postMessage(message: PiperWorkerRequest): void {
    this.requests.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: PiperWorkerResponse): void {
    this.onmessage?.(new MessageEvent('message', { data: response }));
  }
}

describe('Piper speech engine', () => {
  it('pins only the selected model files to the reviewed voice repository commit', () => {
    expect(
      pinnedPiperModelUrl(
        'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/en/en_US/libritts/high/en_US-libritts-high.onnx',
      ),
    ).toBe(
      'https://huggingface.co/rhasspy/piper-voices/resolve/375a0fe641dea077c2a47b4e9a056d6da521eed3/en/en_US/libritts/high/en_US-libritts-high.onnx',
    );
    expect(
      pinnedPiperModelUrl(
        'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/en/en_US/hfc_female/medium/model.onnx',
      ),
    ).toBeUndefined();
    expect(
      pinnedPiperModelUrl(
        'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/en/en_US/libritts/high/en_US-libritts-high.onnx?text=story',
      ),
    ).toBeUndefined();
  });

  it('decodes Piper 16-bit mono WAV output to normalized float PCM', () => {
    const audio = decodePiperWav(makePcmWav([16_384, -32_768]));
    expect(audio).toEqual({
      samples: new Float32Array([0.5, -1]),
      sampleRate: 22_050,
      channels: 1,
    });
  });

  it('rejects unsupported or truncated WAV output', () => {
    expect(() => decodePiperWav(new ArrayBuffer(16))).toThrow(/invalid audio chunk/i);
    const truncated = makePcmWav([10]).slice(0, 45);
    expect(() => decodePiperWav(truncated)).toThrow(/truncated audio chunk/i);
  });

  it('records the exact downloadable voice and its model size for transparent estimates', () => {
    expect(PIPER_VOICE.id).toBe('en_US-libritts-high');
    expect(PIPER_VOICE.modelBytes).toBe(136_673_811);
    expect(PIPER_VOICE.datasetLicense).toBe('CC BY 4.0 (LibriTTS)');
  });

  it('maps the selected speed to Piper length scale without resampling its pitch', () => {
    expect(piperLengthScale(1.05, 2)).toBe(0.525);
    expect(piperLengthScale(1.05, 0.5)).toBe(2.1);
    expect(piperLengthScale(1.05, 1)).toBe(1.05);
    expect(() => piperLengthScale(1.05, 3)).toThrow(/speed/u);
  });

  it('sanitizes speech-only Unicode/PDF artifacts while preserving spoken text', () => {
    const source = 'The ﬁle—“quoted”\u00ad text\u200b.\nA\u00a0second line\uFFFD.';
    expect(sanitizeSpeechInput(source)).toBe('The file-"quoted" text. A second line.');
    expect(source).toContain('\u00ad');
  });

  it('drops phoneme IDs outside the loaded voice map before ONNX inference', () => {
    const voiceMap = Object.fromEntries(
      Array.from({ length: 130 }, (_, id) => [`symbol-${id}`, [id]]),
    );
    const reportedGatherFailure = { sentence: 'Unusual input phrase.', phonemeIds: [1, 14, 144, 129, 130] };
    expect(filterPiperPhonemeIds(reportedGatherFailure.phonemeIds, voiceMap)).toEqual({
      ids: [1, 14, 129],
      dropped: 2,
    });
  });

  it('returns synthesized PCM from its worker, applies volume and forwards download progress', async () => {
    const worker = new MockPiperWorker();
    const provider = new PiperSpeechProvider(() => worker);
    provider.setVolume(0.5);
    const onProgress = vi.fn();
    const resultPromise = provider.synthesize('A private passage.', onProgress);
    const request = worker.requests[0];
    expect(request).toMatchObject({ type: 'synthesize', text: 'A private passage.' });
    if (request.type !== 'synthesize') throw new Error('Expected a synthesis request.');
    worker.respond({ requestId: request.requestId, type: 'progress', loaded: 2, total: 4 });
    worker.respond({
      requestId: request.requestId,
      type: 'audio',
      audio: { samples: new Float32Array([0.8]), sampleRate: 22_050, channels: 1 },
    });
    await expect(resultPromise).resolves.toEqual({
      samples: new Float32Array([0.4]),
      sampleRate: 22_050,
      channels: 1,
    });
    expect(onProgress).toHaveBeenCalledWith(2, 4);
  });

  it('restarts the worker after removing the local voice model', async () => {
    const workers: MockPiperWorker[] = [];
    const provider = new PiperSpeechProvider(() => {
      const worker = new MockPiperWorker();
      workers.push(worker);
      return worker;
    });
    const removePromise = provider.removeVoice();
    const request = workers[0].requests[0];
    if (request.type !== 'remove') throw new Error('Expected a voice removal request.');
    workers[0].respond({ requestId: request.requestId, type: 'done' });
    await removePromise;
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
  });
});
