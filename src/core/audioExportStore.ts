import type { PcmAudio } from './speech';
import type { AudioExportSettings, ExportMetadata } from './audioExport';

export type ExportChapterManifest = {
  id: string;
  title: string;
  chunkKeys: string[];
  chunkEndsParagraph: boolean[];
  durationSeconds?: number;
  fileName?: string;
};

export type AudioExportManifest = {
  version: 1;
  jobId: string;
  documentFingerprint: string;
  voiceId: string;
  settings: AudioExportSettings;
  metadata: ExportMetadata;
  chapters: ExportChapterManifest[];
  skippedSentences?: Array<{ chapterIndex: number; paragraphIndex: number; sentenceIndex: number }>;
  state: 'generating' | 'paused' | 'interrupted' | 'complete';
  updatedAt: number;
};

const EXPORTS_DIRECTORY = 'psr-audiobook-exports';
const AUDIO_CACHE_DIRECTORY = 'psr-audio-cache';
const PCM_HEADER_BYTES = 8;

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

function isAudioExportSettings(value: unknown): value is AudioExportSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<AudioExportSettings>;
  return (
    (settings.format === 'mp3-zip' || settings.format === 'mp3-chapters' || settings.format === 'wav') &&
    (settings.bitrate === 64 || settings.bitrate === 96 || settings.bitrate === 128) &&
    typeof settings.speed === 'number' &&
    Number.isFinite(settings.speed) &&
    settings.speed >= 0.5 &&
    settings.speed <= 2 &&
    typeof settings.volume === 'number' &&
    Number.isFinite(settings.volume) &&
    settings.volume >= 0 &&
    settings.volume <= 1 &&
    Number.isInteger(settings.pauseBetweenParagraphsMs) &&
    settings.pauseBetweenParagraphsMs! >= 0 &&
    settings.pauseBetweenParagraphsMs! <= 1_000 &&
    Number.isInteger(settings.pauseBetweenChaptersMs) &&
    settings.pauseBetweenChaptersMs! >= 0 &&
    settings.pauseBetweenChaptersMs! <= 3_000 &&
    Array.isArray(settings.chapters) &&
    settings.chapters.every((chapter) => Number.isInteger(chapter) && chapter >= 0)
  );
}

export function isAudioExportManifest(value: unknown, expectedJobId?: string): value is AudioExportManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<AudioExportManifest>;
  return (
    manifest.version === 1 &&
    typeof manifest.jobId === 'string' &&
    /^[0-9a-f]{64}$/u.test(manifest.jobId) &&
    (!expectedJobId || manifest.jobId === expectedJobId) &&
    typeof manifest.documentFingerprint === 'string' &&
    /^fnv1a64-[0-9a-f]{16}$/u.test(manifest.documentFingerprint) &&
    typeof manifest.voiceId === 'string' &&
    isAudioExportSettings(manifest.settings) &&
    Boolean(
      manifest.metadata &&
      typeof manifest.metadata.title === 'string' &&
      typeof manifest.metadata.author === 'string' &&
      typeof manifest.metadata.voice === 'string',
    ) &&
    Array.isArray(manifest.chapters) &&
    manifest.chapters.every(
      (chapter) =>
        Boolean(chapter) &&
        typeof chapter.id === 'string' &&
        typeof chapter.title === 'string' &&
        Array.isArray(chapter.chunkKeys) &&
        chapter.chunkKeys.every((key) => typeof key === 'string' && (!key || /^[0-9a-f]{64}$/u.test(key))) &&
        Array.isArray(chapter.chunkEndsParagraph) &&
        chapter.chunkEndsParagraph.every((ends) => typeof ends === 'boolean') &&
        (chapter.fileName === undefined ||
          (typeof chapter.fileName === 'string' && !/[\\/]/u.test(chapter.fileName))) &&
        (chapter.durationSeconds === undefined ||
          (typeof chapter.durationSeconds === 'number' &&
            Number.isFinite(chapter.durationSeconds) &&
            chapter.durationSeconds >= 0)),
    ) &&
    (manifest.skippedSentences === undefined ||
      (Array.isArray(manifest.skippedSentences) &&
        manifest.skippedSentences.every(
          (warning) =>
            warning &&
            Number.isInteger(warning.chapterIndex) &&
            warning.chapterIndex >= 0 &&
            Number.isInteger(warning.paragraphIndex) &&
            warning.paragraphIndex >= 0 &&
            Number.isInteger(warning.sentenceIndex) &&
            warning.sentenceIndex >= 0,
        ))) &&
    (manifest.state === 'generating' ||
      manifest.state === 'paused' ||
      manifest.state === 'interrupted' ||
      manifest.state === 'complete') &&
    typeof manifest.updatedAt === 'number' &&
    Number.isFinite(manifest.updatedAt)
  );
}

export function friendlyExportStorageError(error: unknown): Error {
  if (isQuotaError(error)) return new Error('Not enough free space for this audiobook export.');
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return new Error('The browser blocked local file storage. Allow storage for this site, then try again.');
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new Error('The audiobook export was cancelled.');
  }
  const knownMessages = new Set([
    'Select at least one chapter to export.',
    'The selected chapters do not contain readable text.',
    'This selection is longer than the 10-hour export limit. Export fewer chapters at a time.',
    'A saved audiobook export no longer matches these chapters or settings. Start a new export.',
    'Not enough free space for this audiobook export. Clear cached audio or select fewer chapters.',
    'The browser does not support the local storage needed for audiobook export.',
    'The voice download failed. Check your connection, then try again.',
    'Not enough free space to download this voice.',
    'The browser could not store the voice files. Check available storage and site permissions.',
    'There is not enough memory to synthesize this passage. Close other tabs or export fewer chapters.',
    'This passage contains characters that this voice cannot process.',
    'The voice could not synthesize this passage. The export will try a shorter sentence.',
    'The voice worker crashed during synthesis. You can resume the export and retry.',
    'A saved audiobook audio chunk is damaged. Remove cached audio and try again.',
    'A saved audiobook audio chunk has an unsupported format.',
    'A chapter is not ready to assemble. Resume the export to finish it.',
    'A completed chapter file is missing. Resume the export to rebuild it.',
    'The audiobook could not be saved on this device.',
  ]);
  const message = error instanceof Error ? error.message : '';
  if (knownMessages.has(message)) return new Error(message);
  return new Error('The audiobook export stopped unexpectedly. You can retry and resume completed audio.');
}

export class AudioExportStore {
  private rootPromise?: Promise<FileSystemDirectoryHandle>;

  private getRoot(): Promise<FileSystemDirectoryHandle> {
    if (typeof navigator.storage?.getDirectory !== 'function') {
      return Promise.reject(
        new Error('This browser does not support the local storage needed for audiobook export.'),
      );
    }
    this.rootPromise ??= navigator.storage.getDirectory();
    return this.rootPromise;
  }

  private async getDirectory(name: string, create = true): Promise<FileSystemDirectoryHandle> {
    return (await this.getRoot()).getDirectoryHandle(name, { create });
  }

  async writeFile(
    directory: FileSystemDirectoryHandle,
    name: string,
    data: BufferSource | Blob,
  ): Promise<void> {
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    let closed = false;
    try {
      await writable.write(data);
      await writable.close();
      closed = true;
    } catch (error) {
      if (!closed) {
        try {
          await writable.abort();
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'Could not clean up an incomplete audiobook file.');
        }
      }
      throw error;
    }
  }

  async readFile(directory: FileSystemDirectoryHandle, name: string): Promise<File | undefined> {
    try {
      return await (await directory.getFileHandle(name)).getFile();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return undefined;
      throw error;
    }
  }

  async writePcm(cacheKey: string, audio: PcmAudio): Promise<void> {
    const directory = await this.getDirectory(AUDIO_CACHE_DIRECTORY);
    const bytes = new Uint8Array(PCM_HEADER_BYTES + audio.samples.length * 2);
    const header = new DataView(bytes.buffer);
    header.setUint32(0, audio.sampleRate, true);
    header.setUint32(4, audio.channels, true);
    const pcm = new DataView(bytes.buffer, PCM_HEADER_BYTES);
    for (let index = 0; index < audio.samples.length; index++) {
      pcm.setInt16(index * 2, Math.round(Math.max(-1, Math.min(1, audio.samples[index])) * 32_767), true);
    }
    await this.writeFile(directory, `${cacheKey}.pcm`, bytes);
  }

  async readPcm(cacheKey: string): Promise<PcmAudio | undefined> {
    const directory = await this.getDirectory(AUDIO_CACHE_DIRECTORY, false).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'NotFoundError') return undefined;
      throw error;
    });
    if (!directory) return undefined;
    const file = await this.readFile(directory, `${cacheKey}.pcm`);
    if (!file) return undefined;
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength < PCM_HEADER_BYTES || (buffer.byteLength - PCM_HEADER_BYTES) % 2 !== 0) {
      throw new Error('A saved audiobook audio chunk is damaged. Remove cached audio and try again.');
    }
    const view = new DataView(buffer);
    const sampleRate = view.getUint32(0, true);
    const channels = view.getUint32(4, true);
    if (sampleRate < 8_000 || sampleRate > 48_000 || channels !== 1) {
      throw new Error('A saved audiobook audio chunk has an unsupported format.');
    }
    const sampleCount = (buffer.byteLength - PCM_HEADER_BYTES) / 2;
    const pcm = new DataView(buffer, PCM_HEADER_BYTES);
    const samples = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index++) samples[index] = pcm.getInt16(index * 2, true) / 32_768;
    return {
      samples,
      sampleRate,
      channels,
    };
  }

  async getJobDirectory(jobId: string, create = true): Promise<FileSystemDirectoryHandle> {
    return this.getDirectory(EXPORTS_DIRECTORY).then((directory) =>
      directory.getDirectoryHandle(`job-${jobId}`, { create }),
    );
  }

  async saveManifest(manifest: AudioExportManifest): Promise<void> {
    const directory = await this.getJobDirectory(manifest.jobId);
    await this.writeFile(
      directory,
      'manifest.json',
      new Blob([JSON.stringify(manifest)], { type: 'application/json' }),
    );
  }

  async readManifest(jobId: string): Promise<AudioExportManifest | undefined> {
    let directory: FileSystemDirectoryHandle;
    try {
      directory = await this.getJobDirectory(jobId, false);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return undefined;
      throw error;
    }
    const file = await this.readFile(directory, 'manifest.json');
    if (!file) return undefined;
    const manifest: unknown = JSON.parse(await file.text());
    if (!isAudioExportManifest(manifest, jobId)) {
      throw new Error('A saved audiobook export cannot be resumed because its progress file is damaged.');
    }
    return manifest;
  }

  async deleteJob(jobId: string, deleteCachedAudio = true): Promise<void> {
    const exportsDirectory = await this.getDirectory(EXPORTS_DIRECTORY, false).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'NotFoundError') return undefined;
      throw error;
    });
    if (!exportsDirectory) return;
    const manifest = await this.readManifest(jobId);
    if (deleteCachedAudio && manifest) {
      const cache = await this.getDirectory(AUDIO_CACHE_DIRECTORY, false).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'NotFoundError') return undefined;
        throw error;
      });
      if (cache) {
        const keys = new Set(manifest.chapters.flatMap((chapter) => chapter.chunkKeys));
        const stillUsed = new Set(
          (await this.listManifests())
            .filter((item) => item.jobId !== jobId)
            .flatMap((item) => item.chapters.flatMap((chapter) => chapter.chunkKeys)),
        );
        for (const key of keys) if (!stillUsed.has(key)) await this.removeEntry(cache, `${key}.pcm`);
      }
    }
    await this.removeEntry(exportsDirectory, `job-${jobId}`, true);
  }

  async deleteCachedAudio(): Promise<void> {
    const root = await this.getRoot();
    await this.removeEntry(root, AUDIO_CACHE_DIRECTORY, true);
    await this.removeEntry(root, EXPORTS_DIRECTORY, true);
  }

  async listManifests(): Promise<AudioExportManifest[]> {
    const directory = await this.getDirectory(EXPORTS_DIRECTORY, false).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'NotFoundError') return undefined;
      throw error;
    });
    if (!directory) return [];
    const manifests: AudioExportManifest[] = [];
    for await (const [name, handle] of directory.entries()) {
      if (!name.startsWith('job-') || handle.kind !== 'directory') continue;
      const manifestFile = await this.readFile(handle, 'manifest.json');
      if (!manifestFile) continue;
      const data: unknown = JSON.parse(await manifestFile.text());
      if (isAudioExportManifest(data)) manifests.push(data);
    }
    return manifests;
  }

  async removeEntry(directory: FileSystemDirectoryHandle, name: string, recursive = false): Promise<void> {
    try {
      await directory.removeEntry(name, { recursive });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }
  }

  async removeAllAppData(includeVoiceModel = true): Promise<boolean> {
    const root = await this.getRoot();
    let removed = true;
    for (const name of [
      'psr-audiobook-exports',
      'psr-audio-cache',
      ...(includeVoiceModel ? ['piper'] : []),
    ]) {
      try {
        await root.removeEntry(name, { recursive: true });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') continue;
        removed = false;
      }
    }
    return removed;
  }

  async getUsageEstimate(): Promise<StorageEstimate> {
    if (typeof navigator.storage?.estimate !== 'function') {
      throw new Error('The browser could not check available storage space.');
    }
    return navigator.storage.estimate();
  }
}
