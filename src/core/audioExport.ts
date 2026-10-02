import { Mp3Encoder } from '@breezystack/lamejs';
import { Zip, ZipPassThrough } from 'fflate';
import { splitSentences, type Chapter, type Paragraph, type Story } from './document';
import type { PcmAudio } from './speech';

export type AudioExportFormat = 'mp3-zip' | 'mp3-chapters' | 'wav';
export type AudioExportSettings = {
  format: AudioExportFormat;
  bitrate: 64 | 96 | 128;
  speed: number;
  volume: number;
  pauseBetweenParagraphsMs: number;
  pauseBetweenChaptersMs: number;
  chapters: number[];
  executionMode?: 'auto' | 'cpu' | 'gpu';
  workerCount?: 'auto' | 1 | 2 | 3 | 4;
};
export type ExportMetadata = { title: string; author: string; voice: string; albumTitle?: string };
export type TextAudioChunk = {
  text: string;
  endsParagraph: boolean;
  paragraphIndex: number;
  sentenceIndex: number;
};

const WAV_SAMPLE_RATE = 24_000;
const NORMALIZED_RMS = 0.12;
const MAX_PEAK = 0.89125;
const MAX_SYNTHESIS_CHARS = 380;

export function createSentenceChunks(paragraphs: Paragraph[]): TextAudioChunk[] {
  const chunks: TextAudioChunk[] = [];
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    const sentences = splitSentences(paragraph.text);
    const paragraphChunks: Array<{ text: string; sentenceIndex: number }> = [];
    let bufferedText = '';
    let bufferedSentenceIndex = 0;
    const flushBuffered = () => {
      if (!bufferedText) return;
      paragraphChunks.push({ text: bufferedText, sentenceIndex: bufferedSentenceIndex });
      bufferedText = '';
    };
    for (const [sentenceIndex, sentence] of sentences.entries()) {
      let remaining = sentence.trim();
      while (remaining.length > MAX_SYNTHESIS_CHARS) {
        flushBuffered();
        let splitAt = remaining.lastIndexOf(' ', MAX_SYNTHESIS_CHARS);
        if (splitAt < 1) splitAt = MAX_SYNTHESIS_CHARS;
        paragraphChunks.push({ text: remaining.slice(0, splitAt).trim(), sentenceIndex });
        remaining = remaining.slice(splitAt).trim();
      }
      if (!remaining) continue;
      if (bufferedText && bufferedText.length + remaining.length + 1 > MAX_SYNTHESIS_CHARS) {
        flushBuffered();
      }
      if (!bufferedText) bufferedSentenceIndex = sentenceIndex;
      bufferedText = bufferedText ? `${bufferedText} ${remaining}` : remaining;
    }
    flushBuffered();
    for (const [index, chunk] of paragraphChunks.entries()) {
      chunks.push({
        text: chunk.text,
        endsParagraph: index === paragraphChunks.length - 1,
        paragraphIndex,
        sentenceIndex: chunk.sentenceIndex,
      });
    }
  }
  return chunks;
}

export function sanitizeFileName(name: string): string {
  const safe = name
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*]/g, '-')
    .split('')
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
    .replace(/[. ]+$/g, '')
    .replace(/\.{2,}/g, '-')
    .trim();
  if (!safe || safe === '.' || safe === '..') return 'audiobook';
  const truncated = safe.slice(0, 120);
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(truncated) ? `_${truncated}` : truncated;
}

export function estimateAudioSeconds(story: Story, chapterIndexes: number[], wordsPerMinute = 150): number {
  const words = chapterIndexes.reduce((sum, chapterIndex) => {
    const chapter = story.chapters[chapterIndex];
    return (
      sum +
      (chapter?.paragraphs.reduce((chapterWords, paragraph) => {
        return chapterWords + paragraph.text.split(/\s+/u).filter(Boolean).length;
      }, 0) ?? 0)
    );
  }, 0);
  return words ? (words / Math.max(1, wordsPerMinute)) * 60 : 0;
}

export function estimateExportBytes(
  durationSeconds: number,
  format: AudioExportFormat,
  bitrate: number,
): number {
  if (format === 'wav') return Math.ceil(durationSeconds * WAV_SAMPLE_RATE * 2) + 128;
  const mp3Bytes = Math.ceil((durationSeconds * bitrate * 1_000) / 8);
  return format === 'mp3-zip' ? Math.ceil(mp3Bytes * 1.01) + 512 : mp3Bytes + 2_048;
}

export function estimateGenerationSeconds(durationSeconds: number, measuredSpeed: number): number {
  if (!Number.isFinite(measuredSpeed) || measuredSpeed <= 0) return durationSeconds * 4;
  return Math.ceil(durationSeconds * measuredSpeed);
}

export function estimateRollingEtaSeconds(
  completedChunkDurationsMs: readonly number[],
  remainingChunks: number,
  minimumSamples = 5,
  concurrency = 1,
): number | undefined {
  if (
    completedChunkDurationsMs.length < minimumSamples ||
    !Number.isInteger(remainingChunks) ||
    remainingChunks < 0 ||
    !Number.isFinite(concurrency) ||
    concurrency < 1
  ) {
    return undefined;
  }
  const recent = completedChunkDurationsMs.slice(-10);
  const averageMs = recent.reduce((total, duration) => total + duration, 0) / recent.length;
  return Math.ceil((averageMs * remainingChunks) / (1_000 * concurrency));
}

export function recommendedSynthesisWorkers(
  hardwareConcurrency: number,
  deviceMemoryGiB: number | undefined,
  modelBytes: number,
  preferredWorkerCount: number | 'auto' = 'auto',
): number {
  const availableCores = Number.isFinite(hardwareConcurrency) ? Math.max(1, Math.floor(hardwareConcurrency)) : 1;
  const target = Math.max(1, Math.min(4, Math.floor(availableCores / 2)));
  if (!Number.isFinite(deviceMemoryGiB) || deviceMemoryGiB! <= 0 || modelBytes <= 0) return 1;
  const estimatedWorkerBytes = modelBytes * 2.5;
  const memoryBudgetBytes = deviceMemoryGiB! * 1024 ** 3 * 0.2;
  const memoryLimit = Math.max(1, Math.floor(memoryBudgetBytes / estimatedWorkerBytes));
  const preferred = preferredWorkerCount === 'auto' ? target : Math.max(1, Math.floor(preferredWorkerCount));
  return Math.min(target, memoryLimit, preferred);
}

export async function audioCacheKey(input: {
  documentFingerprint: string;
  voice: string;
  speed: number;
  provider: string;
  text: string;
  pronunciationVersion?: string;
}): Promise<string> {
  const bytes = new TextEncoder().encode(input.text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const textHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const key = [
    input.documentFingerprint,
    input.provider,
    input.voice,
    input.speed.toFixed(3),
    input.pronunciationVersion ?? 'pronunciation-0',
    textHash,
  ].join(':');
  const keyDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(keyDigest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizePcm(audio: PcmAudio): PcmAudio {
  let squareSum = 0;
  let peak = 0;
  for (const sample of audio.samples) {
    squareSum += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = Math.sqrt(squareSum / Math.max(1, audio.samples.length));
  if (rms < 1e-6 || peak < 1e-6) return { ...audio, samples: audio.samples.slice() };
  const gain = Math.min(NORMALIZED_RMS / rms, MAX_PEAK / peak);
  const samples = audio.samples.map((sample) => sample * gain);
  return { ...audio, samples };
}

export function fadePcmBoundaries(audio: PcmAudio, durationMs = 5): PcmAudio {
  const samples = audio.samples.slice();
  const fadeLength = Math.min(
    samples.length,
    Math.max(0, Math.round((audio.sampleRate * durationMs) / 1_000)),
  );
  if (!fadeLength) return { ...audio, samples };
  const last = samples.length - 1;
  for (let index = 0; index < fadeLength; index++) {
    const gain = index / fadeLength;
    samples[index] *= gain;
    samples[last - index] *= gain;
  }
  return { ...audio, samples };
}

export function insertSilence(audio: PcmAudio, durationMs: number): PcmAudio {
  const sampleCount = Math.max(0, Math.round((audio.sampleRate * durationMs) / 1_000));
  if (!sampleCount) return { ...audio, samples: audio.samples.slice() };
  const samples = new Float32Array(audio.samples.length + sampleCount);
  samples.set(audio.samples);
  return { ...audio, samples };
}

export function resamplePcm(audio: PcmAudio, sampleRate: number): PcmAudio {
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) {
    throw new Error('Choose an audio sample rate between 8,000 and 48,000 Hz.');
  }
  if (audio.sampleRate === sampleRate) return { ...audio, samples: audio.samples.slice() };
  const outputLength = Math.round((audio.samples.length * sampleRate) / audio.sampleRate);
  const samples = new Float32Array(outputLength);
  const scale = audio.sampleRate / sampleRate;
  for (let index = 0; index < outputLength; index++) {
    const position = index * scale;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = audio.samples[Math.min(left, audio.samples.length - 1)] ?? 0;
    const b = audio.samples[Math.min(left + 1, audio.samples.length - 1)] ?? a;
    samples[index] = a + (b - a) * fraction;
  }
  return { samples, sampleRate, channels: 1 };
}

function pcmToInt16(samples: Float32Array): Int16Array {
  const result = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index++) {
    result[index] = Math.round(Math.max(-1, Math.min(1, samples[index])) * 32_767);
  }
  return result;
}

export class Mp3StreamEncoder {
  private readonly encoder: Mp3Encoder;

  constructor(sampleRate: number, bitrate: 64 | 96 | 128) {
    this.encoder = new Mp3Encoder(1, sampleRate, bitrate);
  }

  push(pcm: Float32Array, onData: (chunk: Uint8Array) => void): void {
    const frameSamples = 1_152;
    for (let offset = 0; offset < pcm.length; offset += frameSamples) {
      const input = pcmToInt16(pcm.subarray(offset, Math.min(offset + frameSamples, pcm.length)));
      const output = this.encoder.encodeBuffer(input);
      if (output.length) onData(output);
    }
  }

  finish(onData: (chunk: Uint8Array) => void): void {
    const tail = this.encoder.flush();
    if (tail.length) onData(tail);
  }
}

export function encodeMp3(pcm: Float32Array, sampleRate: number, bitrate: 64 | 96 | 128): Uint8Array {
  const encoded: Uint8Array[] = [];
  const encoder = new Mp3StreamEncoder(sampleRate, bitrate);
  encoder.push(pcm, (chunk) => encoded.push(chunk));
  encoder.finish((chunk) => encoded.push(chunk));
  const length = encoded.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of encoded) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function syncSafeInteger(value: number): Uint8Array {
  return new Uint8Array([(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f]);
}

function frame(id: string, data: Uint8Array): Uint8Array {
  const header = new Uint8Array(10);
  header.set(new TextEncoder().encode(id), 0);
  header.set(syncSafeInteger(data.length), 4);
  const result = new Uint8Array(header.length + data.length);
  result.set(header);
  result.set(data, header.length);
  return result;
}

function textFrame(id: string, value: string): Uint8Array {
  return frame(id, new Uint8Array([3, ...new TextEncoder().encode(value)]));
}

function userTextFrame(description: string, value: string): Uint8Array {
  return frame(
    'TXXX',
    joinBytes([
      new Uint8Array([3]),
      new TextEncoder().encode(description),
      new Uint8Array([0]),
      new TextEncoder().encode(value),
    ]),
  );
}

function joinBytes(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function createId3Tag(
  metadata: ExportMetadata,
  chapters: Array<{ title: string; startMs: number; endMs: number; startOffset: number; endOffset: number }>,
): Uint8Array {
  const frames = [
    textFrame('TIT2', metadata.title),
    textFrame('TPE1', metadata.author),
    textFrame('TALB', metadata.albumTitle ?? metadata.title),
    userTextFrame('Voice', metadata.voice),
    textFrame('TENC', 'Generated by Private Story Reader'),
  ];
  const childIds = chapters.map((_, index) => `ch${index + 1}`);
  if (chapters.length) {
    frames.push(
      frame(
        'CTOC',
        joinBytes([
          new Uint8Array([...new TextEncoder().encode('toc'), 0, 3, childIds.length]),
          ...childIds.map((id) => new Uint8Array([...new TextEncoder().encode(id), 0])),
          textFrame('TIT2', metadata.title),
        ]),
      ),
    );
    for (const [index, chapter] of chapters.entries()) {
      const elementId = new TextEncoder().encode(childIds[index]);
      const offsets = new Uint8Array(16);
      const view = new DataView(offsets.buffer);
      view.setUint32(0, chapter.startMs);
      view.setUint32(4, chapter.endMs);
      view.setUint32(8, chapter.startOffset);
      view.setUint32(12, chapter.endOffset);
      frames.push(
        frame(
          'CHAP',
          joinBytes([new Uint8Array([...elementId, 0]), offsets, textFrame('TIT2', chapter.title)]),
        ),
      );
    }
  }
  const body = joinBytes(frames);
  const header = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, ...syncSafeInteger(body.length)]);
  return joinBytes([header, body]);
}

export function createChapterMp3(
  metadata: ExportMetadata,
  chapterTitle: string,
  chapterAudio: Uint8Array,
): Uint8Array {
  return joinBytes([
    createId3Tag({ ...metadata, title: chapterTitle, albumTitle: metadata.title }, []),
    chapterAudio,
  ]);
}

export function createWavInfoChunk(metadata: ExportMetadata): Uint8Array {
  const infoEntries: Uint8Array[] = [];
  for (const [id, value] of [
    ['INAM', metadata.title],
    ['IART', metadata.author],
    ['ICMT', `Voice: ${metadata.voice}`],
    ['ISFT', 'Generated by Private Story Reader'],
  ]) {
    const text = new TextEncoder().encode(`${value}\0`);
    const header = new Uint8Array(8);
    header.set(new TextEncoder().encode(id));
    new DataView(header.buffer).setUint32(4, text.length, true);
    infoEntries.push(joinBytes([header, text, ...(text.length % 2 ? [new Uint8Array(1)] : [])]));
  }
  const content = joinBytes([new TextEncoder().encode('INFO'), ...infoEntries]);
  const header = new Uint8Array(8);
  header.set(new TextEncoder().encode('LIST'));
  new DataView(header.buffer).setUint32(4, content.length, true);
  return joinBytes([header, content]);
}

export function createWavHeader(
  dataBytes: number,
  infoBytes: number,
  sampleRate = WAV_SAMPLE_RATE,
): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  header.set(new TextEncoder().encode('RIFF'), 0);
  view.setUint32(4, 36 + infoBytes + dataBytes, true);
  header.set(new TextEncoder().encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  header.set(new TextEncoder().encode('data'), 36);
  view.setUint32(40, dataBytes, true);
  return header;
}

export function encodeWav(
  pcm: Float32Array,
  metadata: ExportMetadata,
  sampleRate = WAV_SAMPLE_RATE,
): Uint8Array {
  const samples = pcmToInt16(pcm);
  const info = createWavInfoChunk(metadata);
  const dataBytes = samples.byteLength;
  return joinBytes([createWavHeader(dataBytes, info.length, sampleRate), pcmToBytes(samples), info]);
}

function pcmToBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index++) view.setInt16(index * 2, samples[index], true);
  return bytes;
}

export async function createChapterZip(
  chapters: Array<{ fileName: string; chunks: AsyncIterable<Uint8Array> }>,
  onData: (chunk: Uint8Array) => Promise<void>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let writeChain = Promise.resolve();
    let settled = false;
    const zip = new Zip((error, data, final) => {
      if (error) {
        settled = true;
        reject(error);
        return;
      }
      writeChain = writeChain.then(() => onData(data));
      if (final) {
        settled = true;
        void writeChain.then(resolve, reject);
      }
    });
    void (async () => {
      try {
        for (const chapter of chapters) {
          const entry = new ZipPassThrough(sanitizeFileName(chapter.fileName));
          zip.add(entry);
          for await (const chunk of chapter.chunks) entry.push(chunk);
          entry.push(new Uint8Array(), true);
        }
        zip.end();
        if (!settled) void writeChain.then(resolve, reject);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('The ZIP archive could not be created.'));
      }
    })();
  });
}

export function selectedChapters(story: Story, chapterIndexes: number[]): Chapter[] {
  const unique = [...new Set(chapterIndexes)].filter(
    (index) => Number.isInteger(index) && index >= 0 && index < story.chapters.length,
  );
  return unique.map((index) => story.chapters[index]);
}
