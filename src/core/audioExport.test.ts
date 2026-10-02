import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  audioCacheKey,
  createSentenceChunks,
  createChapterMp3,
  createChapterZip,
  createId3Tag,
  encodeMp3,
  encodeWav,
  estimateAudioSeconds,
  estimateExportBytes,
  estimateGenerationSeconds,
  estimateRollingEtaSeconds,
  fadePcmBoundaries,
  insertSilence,
  normalizePcm,
  recommendedSynthesisWorkers,
  resamplePcm,
  sanitizeFileName,
  selectedChapters,
  type ExportMetadata,
} from './audioExport';
import { friendlyExportStorageError, isAudioExportManifest } from './audioExportStore';
import type { Story } from './document';

const metadata: ExportMetadata = {
  title: 'A Quiet Story',
  author: 'Reader',
  voice: 'LibriTTS p3922',
};

const story = {
  id: 'story',
  title: 'Story',
  sourceName: 'story.txt',
  text: 'One two. Three.',
  createdAt: 0,
  chapters: [
    { id: 'one', title: 'One', paragraphs: [{ id: 'p1', text: 'One two.' }] },
    { id: 'two', title: 'Two', paragraphs: [{ id: 'p2', text: 'Three.' }] },
  ],
} satisfies Story;

describe('audiobook export primitives', () => {
  it('validates resumable manifests without storing document text', () => {
    const manifest = {
      version: 1,
      jobId: 'a'.repeat(64),
      documentFingerprint: 'fnv1a64-0123456789abcdef',
      voiceId: 'en_US-libritts-high',
      settings: {
        format: 'mp3-zip',
        bitrate: 96,
        speed: 1,
        volume: 1,
        pauseBetweenParagraphsMs: 350,
        pauseBetweenChaptersMs: 1_000,
        chapters: [0],
      },
      metadata,
      chapters: [{ id: 'one', title: 'One', chunkKeys: ['c'.repeat(64)], chunkEndsParagraph: [true] }],
      state: 'interrupted',
      updatedAt: 1,
    };
    expect(isAudioExportManifest(manifest)).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain(story.text);
    expect(isAudioExportManifest({ ...manifest, jobId: '../private-book' })).toBe(false);
    expect(isAudioExportManifest({ ...manifest, settings: { ...manifest.settings, volume: 3 } })).toBe(false);
  });

  it('maps unknown platform errors to a safe, human-readable message', () => {
    expect(friendlyExportStorageError(new Error('C:\\private\\story.txt failed'))).toEqual(
      new Error('The audiobook export stopped unexpectedly. You can retry and resume completed audio.'),
    );
  });

  it('sanitizes path separators, control characters, and empty names', () => {
    expect(sanitizeFileName('../Chapter:\\One?.mp3')).toBe('--Chapter--One-.mp3');
    expect(sanitizeFileName('')).toBe('audiobook');
    expect(sanitizeFileName('..')).toBe('audiobook');
    expect(sanitizeFileName('CON.txt')).toBe('_CON.txt');
    expect(sanitizeFileName('name'.repeat(40))).toHaveLength(120);
  });

  it('merges short sentences without crossing paragraph boundaries or exceeding the model limit', () => {
    const chunks = createSentenceChunks([
      { id: 'p1', text: 'First sentence. Second sentence! Third sentence?' },
      { id: 'p2', text: 'A'.repeat(850) },
    ]);
    expect(chunks[0]).toMatchObject({
      text: 'First sentence. Second sentence! Third sentence?',
      paragraphIndex: 0,
      sentenceIndex: 0,
      endsParagraph: true,
    });
    expect(chunks.slice(1).every((chunk) => chunk.paragraphIndex === 1)).toBe(true);
    expect(chunks.every((chunk) => chunk.text.length <= 380)).toBe(true);
  });

  it('estimates duration, file sizes, and generation time from the selected chapters', () => {
    expect(estimateAudioSeconds(story, [0, 1])).toBe(1.2);
    expect(estimateAudioSeconds(story, [1])).toBe(0.4);
    expect(estimateExportBytes(3_600, 'wav', 96)).toBe(172_800_128);
    expect(estimateExportBytes(3_600, 'mp3-chapters', 96)).toBe(43_202_048);
    expect(estimateGenerationSeconds(600, 2.5)).toBe(1_500);
    expect(selectedChapters(story, [1, 1, -1, 9]).map((chapter) => chapter.title)).toEqual(['Two']);
  });

  it('waits for five completed chunks and estimates ETA from recent chunk timings', () => {
    expect(estimateRollingEtaSeconds([1_000, 1_000, 1_000, 1_000], 5)).toBeUndefined();
    expect(estimateRollingEtaSeconds([1_000, 1_000, 1_000, 1_000, 2_000], 3)).toBe(4);
    expect(estimateRollingEtaSeconds([1_000, 2_000, 3_000, 4_000, 5_000, 6_000], 2)).toBe(7);
    expect(estimateRollingEtaSeconds([1_000, 1_000, 1_000, 1_000, 1_000], 8, 5, 2)).toBe(4);
    expect(estimateRollingEtaSeconds([1_000, 1_000, 1_000, 1_000, 1_000], -1)).toBeUndefined();
  });

  it('caps the synthesis worker pool by cores and a conservative memory budget', () => {
    expect(recommendedSynthesisWorkers(12, 8, 136_673_811)).toBe(4);
    expect(recommendedSynthesisWorkers(4, 4, 136_673_811)).toBe(2);
    expect(recommendedSynthesisWorkers(12, 8, 136_673_811, 1)).toBe(1);
    expect(recommendedSynthesisWorkers(12, 2, 136_673_811, 4)).toBe(1);
    expect(recommendedSynthesisWorkers(12, undefined, 136_673_811)).toBe(1);
    expect(recommendedSynthesisWorkers(1, 16, 136_673_811)).toBe(1);
  });

  it('builds stable text-addressed cache keys without storing text in the result', async () => {
    const input = {
      documentFingerprint: 'book-fingerprint',
      voice: 'libritts-high',
      speed: 1,
      provider: 'piper',
      text: 'Private story text',
    };
    const key = await audioCacheKey(input);
    expect(key).toMatch(/^[0-9a-f]{64}$/u);
    expect(key).toBe(await audioCacheKey(input));
    expect(key).not.toContain(input.text);
    expect(key).not.toBe(await audioCacheKey({ ...input, text: 'Different passage' }));
  });

  it('normalizes RMS consistently without clipping and inserts real silence samples', () => {
    const normalized = normalizePcm({
      samples: new Float32Array([0.2, -0.2, 0.2, -0.2]),
      sampleRate: 22_050,
      channels: 1,
    });
    expect(Math.sqrt(normalized.samples.reduce((sum, sample) => sum + sample ** 2, 0) / 4)).toBeCloseTo(0.12);
    expect(Math.max(...normalized.samples.map(Math.abs))).toBeLessThanOrEqual(0.89125);
    const withSilence = insertSilence(normalized, 100);
    expect(withSilence.samples).toHaveLength(2_209);
    expect(withSilence.samples.slice(-2)).toEqual(new Float32Array([0, 0]));
  });

  it('fades chunk boundaries to zero to reduce clicks between synthesized sentences', () => {
    const faded = fadePcmBoundaries(
      {
        samples: new Float32Array([1, 1, 1, 1, 1]),
        sampleRate: 1_000,
        channels: 1,
      },
      2,
    );
    expect(faded.samples[0]).toBe(0);
    expect(faded.samples[1]).toBe(0.5);
    expect(faded.samples[3]).toBe(0.5);
    expect(faded.samples[4]).toBe(0);
  });

  it('resamples PCM to the requested output rate and rejects unreasonable rates', () => {
    const audio = { samples: new Float32Array([0, 1, 0, -1]), sampleRate: 8_000, channels: 1 };
    const converted = resamplePcm(audio, 16_000);
    expect(converted.samples).toHaveLength(8);
    expect(converted.sampleRate).toBe(16_000);
    expect(() => resamplePcm(audio, 1_000)).toThrow(/sample rate/u);
  });

  it('produces a PCM WAV with INFO metadata and correct sample data size', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), metadata);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE');
    expect(view.getUint32(40, true)).toBe(6);
    expect(new TextDecoder().decode(wav)).toContain('Generated by Private Story Reader');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
  });

  it('encodes a valid mono MP3 stream and ID3 metadata with chapter frames', () => {
    const samples = Float32Array.from(
      { length: 2_205 },
      (_, index) => 0.2 * Math.sin((2 * Math.PI * 440 * index) / 22_050),
    );
    const mp3 = encodeMp3(samples, 22_050, 64);
    expect(mp3.length).toBeGreaterThan(100);
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1] & 0xe0).toBe(0xe0);
    const tag = createId3Tag(metadata, [
      { title: 'Opening', startMs: 0, endMs: 1_000, startOffset: 0, endOffset: 100 },
    ]);
    expect(new TextDecoder().decode(tag.subarray(0, 3))).toBe('ID3');
    expect(new TextDecoder().decode(tag)).toContain('CHAP');
    expect(new TextDecoder().decode(tag)).toContain('CTOC');
    expect(new TextDecoder().decode(tag)).toContain(metadata.title);
    expect(createChapterMp3(metadata, 'Opening', mp3).length).toBeGreaterThan(mp3.length);
  });

  it('writes streamed ZIP data with safe per-chapter names', async () => {
    const chunks: Uint8Array[] = [];
    await createChapterZip(
      [
        {
          fileName: '01 - One.mp3',
          chunks: (async function* () {
            yield new Uint8Array([1, 2, 3]);
          })(),
        },
      ],
      async (chunk) => {
        chunks.push(chunk);
      },
    );
    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const zipBytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      zipBytes.set(chunk, offset);
      offset += chunk.length;
    }
    const zip = await JSZip.loadAsync(zipBytes);
    expect(Object.keys(zip.files)).toEqual(['01 - One.mp3']);
    expect(await zip.file('01 - One.mp3')?.async('uint8array')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('sanitizes archive entry names even when a caller supplies traversal characters', async () => {
    const chunks: Uint8Array[] = [];
    await createChapterZip(
      [
        {
          fileName: '../../private\\story.mp3',
          chunks: (async function* () {
            yield new Uint8Array([7]);
          })(),
        },
      ],
      async (chunk) => {
        chunks.push(chunk);
      },
    );
    const zipBytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      zipBytes.set(chunk, offset);
      offset += chunk.length;
    }
    const zip = await JSZip.loadAsync(zipBytes);
    const [entryName] = Object.keys(zip.files);
    expect(entryName).not.toMatch(/[\\/]/u);
    expect(entryName).not.toContain('..');
  });
});
