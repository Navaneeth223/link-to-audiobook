import { clampVolume, type PcmAudio, type SampleSpeechProvider } from './speech';

export const PIPER_VOICE = {
  id: 'en_US-libritts-high',
  name: 'LibriTTS · p3922',
  language: 'English (United States)',
  sampleRate: 22_050,
  modelBytes: 136_673_811,
  configBytes: 20_163,
  license: 'MIT (Piper voice repository metadata)',
  datasetLicense: 'CC BY 4.0 (LibriTTS)',
} as const;

export const PIPER_MODEL_COMMIT = '375a0fe641dea077c2a47b4e9a056d6da521eed3';
export const PIPER_ONNX_VERSION = '1.30.0';
export const PIPER_PHONEMIZER_VERSION = '1.0.0';
export const PIPER_STORAGE_DIRECTORY = 'piper';
const PIPER_MODEL_MARKER = '.psr-libritts-high.commit';

const modelMirrorPath = '/diffusionstudio/piper-voices/resolve/main/en/en_US/libritts/high/';
const modelPinnedPrefix = `https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_MODEL_COMMIT}/en/en_US/libritts/high/`;
const modelFiles = new Set(['en_US-libritts-high.onnx', 'en_US-libritts-high.onnx.json']);

export async function isPiperVoiceInstalled(): Promise<boolean> {
  if (typeof navigator.storage?.getDirectory !== 'function') return false;
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(PIPER_STORAGE_DIRECTORY);
    const marker = await directory.getFileHandle(PIPER_MODEL_MARKER);
    if ((await (await marker.getFile()).text()).trim() !== PIPER_MODEL_COMMIT) return false;
    const model = await directory.getFileHandle('en_US-libritts-high.onnx');
    const config = await directory.getFileHandle('en_US-libritts-high.onnx.json');
    return (
      (await model.getFile()).size === PIPER_VOICE.modelBytes &&
      (await config.getFile()).size === PIPER_VOICE.configBytes
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return false;
    throw error;
  }
}

export function pinnedPiperModelUrl(input: string | URL): string | undefined {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    return undefined;
  }
  if (url.origin !== 'https://huggingface.co' || url.search || url.hash) return undefined;
  if (!url.pathname.startsWith(modelMirrorPath)) return undefined;
  const fileName = url.pathname.slice(modelMirrorPath.length);
  return modelFiles.has(fileName) ? `${modelPinnedPrefix}${fileName}` : undefined;
}

export function decodePiperWav(buffer: ArrayBuffer): PcmAudio {
  const view = new DataView(buffer);
  const readTag = (offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
  if (buffer.byteLength < 12 || readTag(0) !== 'RIFF' || readTag(8) !== 'WAVE') {
    throw new Error('The voice engine returned an invalid audio chunk.');
  }

  let format: number | undefined;
  let channels: number | undefined;
  let sampleRate: number | undefined;
  let bitsPerSample: number | undefined;
  let dataOffset: number | undefined;
  let dataLength: number | undefined;
  for (let offset = 12; offset + 8 <= buffer.byteLength;) {
    const tag = readTag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > buffer.byteLength)
      throw new Error('The voice engine returned a truncated audio chunk.');
    if (tag === 'fmt ' && size >= 16) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (tag === 'data') {
      dataOffset = body;
      dataLength = size;
    }
    offset = body + size + (size % 2);
  }

  if (
    format !== 1 ||
    channels !== 1 ||
    bitsPerSample !== 16 ||
    !sampleRate ||
    dataOffset === undefined ||
    dataLength === undefined ||
    dataLength % 2
  ) {
    throw new Error('The voice engine returned an unsupported audio format.');
  }
  const samples = new Float32Array(dataLength / 2);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = view.getInt16(dataOffset + index * 2, true) / 32_768;
  }
  return { samples, sampleRate, channels };
}

export function piperLengthScale(baseLengthScale: number, speed: number): number {
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
    throw new Error('Choose a narration speed between 0.5× and 2×.');
  }
  if (!Number.isFinite(baseLengthScale) || baseLengthScale <= 0) {
    throw new Error('The downloadable voice does not expose a supported speed setting.');
  }
  return baseLengthScale / speed;
}

const piperLigatures: Record<string, string> = {
  '\u00c6': 'AE',
  '\u00e6': 'ae',
  '\u0152': 'OE',
  '\u0153': 'oe',
  '\u0132': 'IJ',
  '\u0133': 'ij',
  '\u014a': 'N',
  '\u014b': 'n',
  '\ufb00': 'ff',
  '\ufb01': 'fi',
  '\ufb02': 'fl',
  '\ufb03': 'ffi',
  '\ufb04': 'ffl',
  '\ufb05': 'st',
  '\ufb06': 'st',
};

export function sanitizeSpeechInput(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[ÆæŒœĲĳŊŋﬀﬁﬂﬃﬄﬅﬆ]/gu, (character) => piperLigatures[character] ?? character)
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/[“”„‟]/gu, '"')
    .replace(/[‐‑‒–—―]/gu, '-')
    .replace(/\u2026/gu, '...')
    .replace(/[\u00ad\ufffd\p{Cf}]/gu, '')
    .replace(/\p{Cc}/gu, (character) => (character === '\n' || character === '\r' || character === '\t' ? ' ' : ''))
    .replace(/-\s*\n\s*/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function filterPiperPhonemeIds(
  ids: readonly number[],
  phonemeIdMap: Record<string, number[]> | ReadonlySet<number>,
): { ids: number[]; dropped: number } {
  const allowedIds =
    phonemeIdMap instanceof Set
      ? phonemeIdMap
      : new Set(Object.values(phonemeIdMap).flat().filter(Number.isInteger));
  const filtered = ids.filter((id) => allowedIds.has(id));
  return { ids: filtered, dropped: ids.length - filtered.length };
}

export type PiperWorkerCommand =
  | { type: 'status' }
  | { type: 'download' }
  | { type: 'remove' }
  | { type: 'synthesize'; text: string; speed: number };

export type PiperWorkerRequest =
  | (PiperWorkerCommand & { requestId: number })
  | { requestId: number; type: 'cancel'; targetRequestId: number };

export type PiperWorkerResponse =
  | { requestId: number; type: 'progress'; loaded: number; total: number }
  | { requestId: number; type: 'status'; installed: boolean }
  | { requestId: number; type: 'audio'; audio: PcmAudio }
  | { requestId: number; type: 'done' }
  | { requestId: number; type: 'error'; message: string };

export interface PiperWorkerPort {
  onmessage: ((event: MessageEvent<PiperWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: PiperWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

type PendingRequest = {
  resolve: (response: PiperWorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (loaded: number, total: number) => void;
};

export class PiperSpeechProvider implements SampleSpeechProvider {
  private volume = 1;
  private speed = 1;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly workerFactory: () => PiperWorkerPort;
  private worker: PiperWorkerPort;
  private disposed = false;

  constructor(
    workerFactory: () => PiperWorkerPort = () =>
      new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' }),
  ) {
    this.workerFactory = workerFactory;
    this.worker = this.createWorker();
  }

  private createWorker(): PiperWorkerPort {
    const worker = this.workerFactory();
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = () => {
      this.failAll(new Error('The voice worker crashed during synthesis. You can resume the export and retry.'));
      worker.terminate();
      this.disposed = true;
    };
    return worker;
  }

  setVolume(value: number): void {
    this.volume = clampVolume(value);
  }

  getVolume(): number {
    return this.volume;
  }

  setSpeed(value: number): void {
    this.speed = Number.isFinite(value) ? Math.min(2, Math.max(0.5, value)) : 1;
  }

  async isVoiceInstalled(): Promise<boolean> {
    const response = await this.request({ type: 'status' });
    if (response.type !== 'status') throw new Error('Could not check the downloadable voice status.');
    return response.installed;
  }

  async downloadVoice(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const response = await this.request({ type: 'download' }, onProgress);
    if (response.type !== 'done') throw new Error('The downloadable voice could not be installed.');
  }

  async synthesize(text: string, onProgress?: (loaded: number, total: number) => void): Promise<PcmAudio> {
    if (!text.trim()) throw new Error('There is no text to synthesize.');
    const response = await this.request({ type: 'synthesize', text, speed: this.speed }, onProgress);
    if (response.type !== 'audio')
      throw new Error('The downloadable voice could not synthesize this passage.');
    const samples = response.audio.samples;
    if (this.volume !== 1) {
      for (let index = 0; index < samples.length; index++) samples[index] *= this.volume;
    }
    return response.audio;
  }

  async removeVoice(): Promise<void> {
    const response = await this.request({ type: 'remove' });
    if (response.type !== 'done') throw new Error('The downloadable voice could not be removed.');
    this.worker.terminate();
    this.worker = this.createWorker();
  }

  cancelAll(): void {
    if (this.disposed) return;
    this.failAll(new DOMException('The voice operation was cancelled.', 'AbortError'));
    this.disposed = true;
    this.worker.terminate();
  }

  private request(
    message: PiperWorkerCommand,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<PiperWorkerResponse> {
    if (this.disposed) return Promise.reject(new Error('The downloadable voice worker is closed.'));
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, onProgress });
      this.worker.postMessage({ ...message, requestId });
    });
  }

  private receive(message: PiperWorkerResponse): void {
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    if (message.type === 'progress') {
      pending.onProgress?.(message.loaded, message.total);
      return;
    }
    this.pending.delete(message.requestId);
    if (message.type === 'error') pending.reject(new Error(message.message));
    else pending.resolve(message);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
