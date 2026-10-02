/// <reference lib="webworker" />

import {
  createChapterZip,
  createId3Tag,
  createSentenceChunks,
  createWavHeader,
  createWavInfoChunk,
  estimateAudioSeconds,
  estimateExportBytes,
  estimateRollingEtaSeconds,
  recommendedSynthesisWorkers,
  fadePcmBoundaries,
  normalizePcm,
  resamplePcm,
  sanitizeFileName,
  audioCacheKey,
  selectedChapters,
  Mp3StreamEncoder,
  type AudioExportSettings,
  type ExportMetadata,
  type TextAudioChunk,
} from './audioExport';
import { synthesizeWithRecovery } from './audioSynthesis';
import {
  AudioExportStore,
  friendlyExportStorageError,
  type AudioExportManifest,
  type ExportChapterManifest,
} from './audioExportStore';
import { documentFingerprint } from './bookmarks';
import { type Chapter, type Story } from './document';
import {
  getPiperVoice,
  PIPER_MODEL_COMMIT,
  PiperSpeechProvider,
  piperWorkerThreadCount,
  type PiperVoice,
  type PiperVoiceId,
} from './piper';
import type { PcmAudio } from './speech';

type StartMessage = {
  type: 'start';
  story: Story;
  voiceId: PiperVoiceId;
  settings: AudioExportSettings;
  metadata: ExportMetadata;
  saveHandle?: FileSystemFileHandle;
};
type ControlMessage = { type: 'pause' | 'resume' | 'cancel' };
type WorkerRequest = StartMessage | ControlMessage;
type ChapterStatus = { title: string; status: 'queued' | 'generating' | 'done' | 'failed' };
type WorkerResponse =
  | {
      type: 'progress';
      state: 'preparing' | 'downloading-voice' | 'generating' | 'paused' | 'assembling';
      percent: number;
      completedChunks: number;
      totalChunks: number;
      chapterIndex: number;
      chunkIndex: number;
      elapsedMs: number;
      etaSeconds: number;
      chapters: ChapterStatus[];
      voiceLoaded?: number;
      voiceTotal?: number;
    }
  | {
      type: 'done';
      jobId: string;
      fileName: string;
      previewFileName?: string;
      durationSeconds: number;
      sizeBytes: number;
      savedDirectly: boolean;
      skippedSentenceCount: number;
      skippedSentenceWarnings: string[];
    }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

type ActiveJob = {
  cancelled: boolean;
  paused: boolean;
  providers?: PiperSpeechProvider[];
  startedAt: number;
  recentChunkDurationsMs: number[];
  manifest?: AudioExportManifest;
};

const scope = self as DedicatedWorkerGlobalScope;
const store = new AudioExportStore();
let activeJob: ActiveJob | undefined;
const WAV_RATE = 24_000;
const MAX_EXPORT_SECONDS = 10 * 60 * 60;

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

function sha256(value: string): Promise<string> {
  return crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(value))
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    );
}

function extensionFor(format: AudioExportSettings['format']): string {
  return format === 'wav' ? 'wav' : format === 'mp3-zip' ? 'zip' : 'mp3';
}

function writeBytes(writer: FileSystemWritableFileStream, bytes: Uint8Array): Promise<void> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return writer.write(copy.buffer);
}

async function waitForResume(job: ActiveJob): Promise<void> {
  if (!job.paused) return;
  const manifest = job.manifest;
  if (manifest) {
    manifest.state = 'paused';
    manifest.updatedAt = Date.now();
    await store.saveManifest(manifest);
  }
  while (job.paused && !job.cancelled) await new Promise((resolve) => setTimeout(resolve, 100));
  if (job.cancelled) throw new DOMException('The export was cancelled.', 'AbortError');
  if (manifest) {
    manifest.state = 'generating';
    manifest.updatedAt = Date.now();
    await store.saveManifest(manifest);
  }
}

function postProgress(
  job: ActiveJob,
  state: Extract<WorkerResponse, { type: 'progress' }>['state'],
  completedChunks: number,
  totalChunks: number,
  chapterIndex: number,
  chunkIndex: number,
  chapters: ChapterStatus[],
  voiceLoaded?: number,
  voiceTotal?: number,
): void {
  const elapsedMs = performance.now() - job.startedAt;
  const percent = totalChunks ? Math.min(100, Math.floor((completedChunks / totalChunks) * 100)) : 0;
  const etaSeconds =
    estimateRollingEtaSeconds(
      job.recentChunkDurationsMs,
      totalChunks - completedChunks,
      5,
      job.providers?.length ?? 1,
    ) ?? 0;
  post({
    type: 'progress',
    state,
    percent,
    completedChunks,
    totalChunks,
    chapterIndex,
    chunkIndex,
    elapsedMs,
    etaSeconds,
    chapters,
    ...(voiceLoaded === undefined ? {} : { voiceLoaded }),
    ...(voiceTotal === undefined ? {} : { voiceTotal }),
  });
}

function metadataWithDefaults(
  story: Story,
  metadata: ExportMetadata,
  voice: PiperVoice,
): ExportMetadata {
  return {
    title: sanitizeFileName(metadata.title.trim() || story.title),
    author: metadata.author.trim() || 'Unknown author',
    voice: metadata.voice || voice.name,
  };
}

function withVolume(samples: Float32Array, volume: number): Float32Array {
  const result = samples.slice();
  const gain = Math.max(0, Math.min(1, volume));
  for (let index = 0; index < result.length; index++) result[index] *= gain;
  return result;
}

function pcm16Bytes(samples: Float32Array): Uint8Array {
  const result = new Uint8Array(samples.length * 2);
  const view = new DataView(result.buffer);
  for (let index = 0; index < samples.length; index++) {
    view.setInt16(index * 2, Math.round(Math.max(-1, Math.min(1, samples[index])) * 32_767), true);
  }
  return result;
}

function silence(sampleRate: number, durationMs: number): Float32Array {
  return new Float32Array(Math.max(0, Math.round((sampleRate * durationMs) / 1_000)));
}

async function* fileChunks(file: File): AsyncGenerator<Uint8Array> {
  const reader = file.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function* taggedChapterChunks(
  file: File,
  title: string,
  metadata: ExportMetadata,
): AsyncGenerator<Uint8Array> {
  yield createId3Tag({ ...metadata, title, albumTitle: metadata.title }, []);
  yield* fileChunks(file);
}

async function cachedOrSynthesize(
  job: ActiveJob,
  provider: PiperSpeechProvider,
  text: string,
  fingerprint: string,
  speed: number,
  sentenceIndex: number,
  voice: PiperVoice,
): Promise<{ audio: PcmAudio; key: string; skippedSentenceIndexes: number[] }> {
  const key = await audioCacheKey({
    documentFingerprint: fingerprint,
    provider: `piper-wasm@${PIPER_MODEL_COMMIT}`,
    voice: voice.id,
    speed,
    text,
  });
  const cached = await store.readPcm(key);
  if (cached) return { audio: cached, key, skippedSentenceIndexes: [] };
  if (job.cancelled) throw new DOMException('The export was cancelled.', 'AbortError');
  const result = await synthesizeWithRecovery(provider, text, voice.sampleRate, sentenceIndex);
  const audio = normalizePcm(result.audio);
  if (!audio.samples.length) throw new Error('The voice engine returned an empty audio chunk.');
  if (!result.skippedSentenceIndexes.length) await store.writePcm(key, audio);
  return { audio, key, skippedSentenceIndexes: result.skippedSentenceIndexes };
}

function createManifest(
  jobId: string,
  fingerprint: string,
  voice: PiperVoice,
  settings: AudioExportSettings,
  metadata: ExportMetadata,
  chapters: Array<{ chapter: Chapter; chunks: TextAudioChunk[] }>,
): AudioExportManifest {
  return {
    version: 1,
    jobId,
    documentFingerprint: fingerprint,
    voiceId: voice.id,
    settings,
    metadata,
    chapters: chapters.map(({ chapter, chunks }) => ({
      id: chapter.id,
      title: chapter.title,
      chunkKeys: chunks.map(() => ''),
      chunkEndsParagraph: chunks.map((chunk) => chunk.endsParagraph),
    })),
    skippedSentences: [],
    state: 'generating',
    updatedAt: Date.now(),
  };
}

async function openOutputWriter(
  job: ActiveJob,
  directory: FileSystemDirectoryHandle,
  fileName: string,
  saveHandle?: FileSystemFileHandle,
): Promise<FileSystemWritableFileStream> {
  if (job.cancelled) throw new DOMException('The export was cancelled.', 'AbortError');
  return saveHandle
    ? saveHandle.createWritable()
    : (await directory.getFileHandle(fileName, { create: true })).createWritable();
}

async function readOutputFile(directory: FileSystemDirectoryHandle, fileName: string): Promise<File> {
  const file = await store.readFile(directory, fileName);
  if (!file) throw new Error('A completed chapter file is missing. Resume the export to rebuild it.');
  return file;
}

async function writeAudioChunks(
  job: ActiveJob,
  chapter: Chapter,
  chunks: TextAudioChunk[],
  chapterManifest: ExportChapterManifest,
  providers: PiperSpeechProvider[],
  voice: PiperVoice,
  settings: AudioExportSettings,
  fingerprint: string,
  chapterIndex: number,
  totalChunks: number,
  completedBefore: number,
  statuses: ChapterStatus[],
  outputWriter?: FileSystemWritableFileStream,
): Promise<{ durationSeconds: number; mp3FileName?: string; wavSamples: number }> {
  statuses[chapterIndex] = { title: chapter.title, status: 'generating' };
  let sampleCount = 0;
  let pcm16BytesWritten = 0;
  let writeChain = Promise.resolve();
  const mp3FileName = `chapter-${String(chapterIndex + 1).padStart(4, '0')}.mp3`;
  const mp3Writer =
    settings.format === 'wav'
      ? undefined
      : await (
          await store.getJobDirectory(job.manifest!.jobId)
        )
          .getFileHandle(mp3FileName, { create: true })
          .then((file) => file.createWritable());
  const encoder =
    settings.format === 'wav' ? undefined : new Mp3StreamEncoder(voice.sampleRate, settings.bitrate);
  const queueMp3 = (bytes: Uint8Array) => {
    if (!mp3Writer) return;
    writeChain = writeChain.then(() => writeBytes(mp3Writer, bytes));
  };
  const prepared = new Map<
    number,
    Promise<{ value: Awaited<ReturnType<typeof cachedOrSynthesize>>; elapsedMs: number }>
  >();
  let nextToPrepare = 0;
  const prepareUpcoming = () => {
    while (prepared.size < providers.length && nextToPrepare < chunks.length) {
      const index = nextToPrepare++;
      const provider = providers[index % providers.length];
      if (!provider) throw new Error('A synthesis worker could not be prepared.');
      const startedAt = performance.now();
      const task = cachedOrSynthesize(
        job,
        provider,
        chunks[index]!.text,
        fingerprint,
        settings.speed,
        chunks[index]!.sentenceIndex,
        voice,
      ).then((value) => ({ value, elapsedMs: performance.now() - startedAt }));
      void task.catch(() => undefined);
      prepared.set(index, task);
    }
  };

  try {
    prepareUpcoming();
    for (const [chunkIndex, chunk] of chunks.entries()) {
      await waitForResume(job);
      if (job.cancelled) throw new DOMException('The export was cancelled.', 'AbortError');
      const current = prepared.get(chunkIndex);
      if (!current) throw new Error('A synthesis worker did not return the next audio chunk.');
      const { value: cached, elapsedMs } = await current;
      prepared.delete(chunkIndex);
      prepareUpcoming();
      for (const sentenceIndex of cached.skippedSentenceIndexes) {
        const skipped = {
          chapterIndex,
          paragraphIndex: chunk.paragraphIndex,
          sentenceIndex,
        };
        const skippedSentences = (job.manifest!.skippedSentences ??= []);
        if (
          !skippedSentences.some(
            (entry) =>
              entry.chapterIndex === skipped.chapterIndex &&
              entry.paragraphIndex === skipped.paragraphIndex &&
              entry.sentenceIndex === skipped.sentenceIndex,
          )
        ) {
          skippedSentences.push(skipped);
        }
      }
      let audio = resamplePcm(cached.audio, settings.format === 'wav' ? WAV_RATE : voice.sampleRate);
      audio = fadePcmBoundaries(audio);
      const key = cached.key;
      chapterManifest.chunkKeys[chunkIndex] = key;
      const samples = withVolume(audio.samples, settings.volume);
      if (settings.format === 'wav') {
        await writeBytes(outputWriter!, pcm16Bytes(samples));
        pcm16BytesWritten += samples.length * 2;
      } else {
        encoder!.push(samples, queueMp3);
        await writeChain;
      }
      sampleCount += samples.length;
      const isFinalChunk = chunkIndex === chunks.length - 1;
      const pauseMs =
        chunk.endsParagraph && !isFinalChunk
          ? settings.pauseBetweenParagraphsMs
          : isFinalChunk && chapterIndex < statuses.length - 1
            ? settings.pauseBetweenChaptersMs
            : 0;
      if (pauseMs) {
        const pause = silence(audio.sampleRate, pauseMs);
        if (settings.format === 'wav') {
          const wavPause = silence(WAV_RATE, pauseMs);
          await writeBytes(outputWriter!, pcm16Bytes(wavPause));
          pcm16BytesWritten += wavPause.length * 2;
          sampleCount += wavPause.length;
        } else {
          encoder!.push(pause, queueMp3);
          await writeChain;
          sampleCount += pause.length;
        }
      }
      chapterManifest.chunkKeys[chunkIndex] = key;
      job.manifest!.updatedAt = Date.now();
      await store.saveManifest(job.manifest!);
      job.recentChunkDurationsMs.push(elapsedMs);
      postProgress(
        job,
        'generating',
        completedBefore + chunkIndex + 1,
        totalChunks,
        chapterIndex,
        chunkIndex + 1,
        statuses,
      );
    }
    if (encoder) {
      encoder.finish(queueMp3);
      await writeChain;
      await mp3Writer!.close();
      const directory = await store.getJobDirectory(job.manifest!.jobId);
      if (!(await store.readFile(directory, mp3FileName))) {
        throw new Error('A generated chapter could not be read back from local storage.');
      }
      chapterManifest.fileName = mp3FileName;
      chapterManifest.durationSeconds = sampleCount / voice.sampleRate;
      statuses[chapterIndex] = { title: chapter.title, status: 'done' };
      job.manifest!.updatedAt = Date.now();
      await store.saveManifest(job.manifest!);
      return {
        durationSeconds: chapterManifest.durationSeconds,
        mp3FileName,
        wavSamples: pcm16BytesWritten,
      };
    }
    chapterManifest.durationSeconds = sampleCount / WAV_RATE;
    statuses[chapterIndex] = { title: chapter.title, status: 'done' };
    job.manifest!.updatedAt = Date.now();
    await store.saveManifest(job.manifest!);
    return {
      durationSeconds: chapterManifest.durationSeconds,
      wavSamples: pcm16BytesWritten,
    };
  } catch (error) {
    statuses[chapterIndex] = { title: chapter.title, status: 'failed' };
    try {
      if (mp3Writer) await mp3Writer.abort();
    } catch {
      // The writable may already have been closed by the browser.
    }
    throw error;
  }
}

async function assembleOutput(
  job: ActiveJob,
  directory: FileSystemDirectoryHandle,
  settings: AudioExportSettings,
  metadata: ExportMetadata,
  fileName: string,
  saveHandle?: FileSystemFileHandle,
  wavWriter?: FileSystemWritableFileStream,
  wavDataBytes = 0,
): Promise<{ sizeBytes: number; savedDirectly: boolean }> {
  if (settings.format === 'wav') {
    if (!wavWriter) throw new Error('The WAV output stream was not prepared.');
    const info = createWavInfoChunk(metadata);
    await writeBytes(wavWriter, info);
    await wavWriter.seek(0);
    await writeBytes(wavWriter, createWavHeader(wavDataBytes, info.length, WAV_RATE));
    await wavWriter.close();
    const file = saveHandle ? await saveHandle.getFile() : await readOutputFile(directory, fileName);
    return { sizeBytes: file.size, savedDirectly: Boolean(saveHandle) };
  }

  const chapters = job.manifest!.chapters;
  const files: File[] = [];
  for (const chapter of chapters) {
    if (!chapter.fileName || chapter.durationSeconds === undefined) {
      throw new Error('A chapter is not ready to assemble. Resume the export to finish it.');
    }
    files.push(await readOutputFile(directory, chapter.fileName));
  }
  const writer = await openOutputWriter(job, directory, fileName, saveHandle);
  let fileSize = 0;
  const write = async (chunk: Uint8Array) => {
    if (job.cancelled) throw new DOMException('The export was cancelled.', 'AbortError');
    await writeBytes(writer, chunk);
    fileSize += chunk.byteLength;
  };
  try {
    if (settings.format === 'mp3-zip') {
      const sources = files.map((file, index) => {
        const chapter = chapters[index];
        const originalChapterIndex = settings.chapters[index];
        return {
          fileName: sanitizeFileName(
            `${String(originalChapterIndex + 1).padStart(2, '0')} - ${chapter.title}.mp3`,
          ),
          chunks: taggedChapterChunks(file, chapter.title, metadata),
        };
      });
      await createChapterZip(sources, write);
    } else {
      let elapsedMs = 0;
      let byteOffset = 0;
      const frameData = chapters.map((chapter, index) => {
        const startMs = elapsedMs;
        const endMs = startMs + Math.round(chapter.durationSeconds! * 1_000);
        const startOffset = byteOffset;
        const endOffset = startOffset + files[index].size;
        elapsedMs = endMs;
        byteOffset = endOffset;
        return { title: chapter.title, startMs, endMs, startOffset, endOffset };
      });
      await write(createId3Tag(metadata, frameData));
      for (const file of files) for await (const chunk of fileChunks(file)) await write(chunk);
    }
    await writer.close();
    const resultFile = saveHandle ? await saveHandle.getFile() : await readOutputFile(directory, fileName);
    return { sizeBytes: resultFile.size || fileSize, savedDirectly: Boolean(saveHandle) };
  } catch (error) {
    try {
      await writer.abort();
    } catch {
      // The writable may have already been aborted by the browser.
    }
    throw error;
  }
}

async function runExport(message: StartMessage, job: ActiveJob): Promise<void> {
  const { story, settings } = message;
  const voice = getPiperVoice(message.voiceId);
  if (!voice) throw new Error('The selected downloadable voice is not available.');
  const chapters = selectedChapters(story, settings.chapters);
  if (!chapters.length) throw new Error('Select at least one chapter to export.');
  const fingerprint = documentFingerprint(story);
  const metadata = metadataWithDefaults(story, message.metadata, voice);
  const chapterPlans = chapters.map((chapter) => ({
    chapter,
    chunks: createSentenceChunks(chapter.paragraphs),
  }));
  const totalChunks = chapterPlans.reduce((total, plan) => total + plan.chunks.length, 0);
  if (!totalChunks) throw new Error('The selected chapters do not contain readable text.');
  const durationEstimate = estimateAudioSeconds(story, settings.chapters);
  if (durationEstimate > MAX_EXPORT_SECONDS) {
    throw new Error(
      'This selection is longer than the 10-hour export limit. Export fewer chapters at a time.',
    );
  }
  const fileName = `${sanitizeFileName(metadata.title)}.${extensionFor(settings.format)}`;
  const jobId = await sha256(
    JSON.stringify({
      fingerprint,
      voiceId: voice.id,
      settings,
      metadata,
      chapters: chapterPlans.map(({ chapter, chunks }) => ({
        id: chapter.id,
        title: chapter.title,
        chunkCount: chunks.length,
      })),
    }),
  );
  const cacheBytes = Math.ceil(durationEstimate * voice.sampleRate * 2);
  const requiredBytes = cacheBytes + estimateExportBytes(durationEstimate, settings.format, settings.bitrate);
  const estimate = await store.getUsageEstimate();
  if (
    estimate.quota !== undefined &&
    estimate.usage !== undefined &&
    estimate.quota - estimate.usage < requiredBytes
  ) {
    throw new Error(
      'Not enough free space for this audiobook export. Clear cached audio or select fewer chapters.',
    );
  }
  const existing = await store.readManifest(jobId);
  if (
    existing &&
    (existing.documentFingerprint !== fingerprint ||
      existing.voiceId !== voice.id ||
      JSON.stringify(existing.settings) !== JSON.stringify(settings) ||
      JSON.stringify(existing.metadata) !== JSON.stringify(metadata) ||
      existing.chapters.length !== chapterPlans.length ||
      existing.chapters.some(
        (chapter, index) =>
          chapter.id !== chapterPlans[index].chapter.id ||
          chapter.title !== chapterPlans[index].chapter.title ||
          chapter.chunkKeys.length !== chapterPlans[index].chunks.length ||
          JSON.stringify(chapter.chunkEndsParagraph) !==
            JSON.stringify(chapterPlans[index].chunks.map((chunk) => chunk.endsParagraph)),
      ))
  ) {
    throw new Error(
      'A saved audiobook export no longer matches these chapters or settings. Start a new export.',
    );
  }
  const manifest = existing ?? createManifest(jobId, fingerprint, voice, settings, metadata, chapterPlans);
  manifest.state = 'generating';
  manifest.updatedAt = Date.now();
  job.manifest = manifest;
  await store.saveManifest(manifest);

  const availableThreads = Math.max(1, scope.navigator.hardwareConcurrency || 1);
  const deviceMemory = Reflect.get(scope.navigator, 'deviceMemory');
  const workerCount = recommendedSynthesisWorkers(
    availableThreads,
    typeof deviceMemory === 'number' ? deviceMemory : undefined,
    voice.modelBytes,
    settings.workerCount ?? 'auto',
  );
  const threadLimitPerWorker = piperWorkerThreadCount(
    scope.crossOriginIsolated,
    availableThreads,
    workerCount,
  );
  const providers = Array.from({ length: workerCount }, () => new PiperSpeechProvider());
  job.providers = providers;
  for (const provider of providers) {
    provider.setVolume(1);
    provider.setSpeed(settings.speed);
    provider.setVoiceId(voice.id);
    provider.setExecutionMode(settings.executionMode ?? 'auto');
    provider.setThreadLimit(threadLimitPerWorker);
  }
  const provider = providers[0];
  if (!provider) throw new Error('A synthesis worker could not be prepared.');
  if (!(await provider.isVoiceInstalled())) {
    postProgress(job, 'downloading-voice', 0, totalChunks, 0, 0, []);
    await provider.downloadVoice((loaded, total) =>
      postProgress(job, 'downloading-voice', 0, totalChunks, 0, 0, [], loaded, total),
    );
  }
  postProgress(job, 'preparing', 0, totalChunks, 0, 0, []);
  await Promise.all(providers.map((synthesisProvider) => synthesisProvider.prepare()));

  const statuses: ChapterStatus[] = chapterPlans.map(({ chapter }) => ({
    title: chapter.title,
    status: 'queued',
  }));
  const jobDirectory = await store.getJobDirectory(jobId);
  const outputWriter =
    settings.format === 'wav'
      ? await openOutputWriter(job, jobDirectory, fileName, message.saveHandle)
      : undefined;
  let wavDataBytes = 0;
  if (outputWriter) await writeBytes(outputWriter, new Uint8Array(44));
  let completedChunks = 0;
  const chapterDurations: number[] = [];

  try {
    for (const [chapterIndex, plan] of chapterPlans.entries()) {
      const cachedManifest = manifest.chapters[chapterIndex] ?? {
        id: plan.chapter.id,
        title: plan.chapter.title,
        chunkKeys: [],
        chunkEndsParagraph: [],
      };
      manifest.chapters[chapterIndex] = cachedManifest;
      const chunkKeys = plan.chunks.map((_, chunkIndex) => cachedManifest.chunkKeys[chunkIndex] || '');
      cachedManifest.chunkEndsParagraph = plan.chunks.map((chunk) => chunk.endsParagraph);
      const chapterManifest = cachedManifest;
      const result = await writeAudioChunks(
        job,
        plan.chapter,
        plan.chunks,
        chapterManifest,
        providers,
        voice,
        settings,
        fingerprint,
        chapterIndex,
        totalChunks,
        completedChunks,
        statuses,
        outputWriter,
      );
      completedChunks += plan.chunks.length;
      chapterDurations.push(result.durationSeconds);
      wavDataBytes += result.wavSamples;
      if (settings.format !== 'wav') {
        const file = await store.readFile(jobDirectory, result.mp3FileName!);
        if (!file) throw new Error('A chapter could not be saved. Check available storage and try again.');
        chapterManifest.fileName = result.mp3FileName;
      }
      chapterManifest.chunkKeys = chunkKeys.map((key, index) => chapterManifest.chunkKeys[index] || key);
      manifest.updatedAt = Date.now();
      await store.saveManifest(manifest);
    }
  } catch (error) {
    if (outputWriter) {
      try {
        await outputWriter.abort();
      } catch {
        // The output may already have been aborted by the browser.
      }
    }
    throw error;
  }

  postProgress(job, 'assembling', completedChunks, totalChunks, chapters.length, 0, statuses);
  const output = await assembleOutput(
    job,
    jobDirectory,
    settings,
    metadata,
    fileName,
    message.saveHandle,
    outputWriter,
    wavDataBytes,
  );
  manifest.state = 'complete';
  manifest.updatedAt = Date.now();
  await store.saveManifest(manifest);
  const totalDuration = chapterDurations.reduce((sum, duration) => sum + duration, 0);
  post({
    type: 'done',
    jobId,
    fileName,
    ...(settings.format === 'mp3-zip' ? { previewFileName: manifest.chapters[0]?.fileName } : {}),
    durationSeconds: totalDuration,
    sizeBytes: output.sizeBytes,
    savedDirectly: output.savedDirectly,
    skippedSentenceCount: manifest.skippedSentences?.length ?? 0,
    skippedSentenceWarnings: (manifest.skippedSentences ?? []).map(({ chapterIndex, paragraphIndex }) => {
      const chapterTitle = chapterPlans[chapterIndex]?.chapter.title ?? 'Selected chapter';
      return `${chapterTitle}, paragraph ${paragraphIndex + 1}`;
    }),
  });
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'start') {
    if (activeJob) {
      post({ type: 'error', message: 'An audiobook export is already running.' });
      return;
    }
    const job: ActiveJob = {
      cancelled: false,
      paused: false,
      startedAt: performance.now(),
      recentChunkDurationsMs: [],
    };
    activeJob = job;
    void runExport(message, job)
      .catch(async (error: unknown) => {
        if (job.cancelled) {
          try {
            if (job.manifest) await store.deleteJob(job.manifest.jobId);
            post({ type: 'cancelled' });
          } catch {
            post({
              type: 'error',
              message: 'Export cancelled, but some temporary audio could not be removed.',
            });
          }
          return;
        }
        if (job.manifest) {
          job.manifest.state = 'interrupted';
          job.manifest.updatedAt = Date.now();
        }
        let safeError = friendlyExportStorageError(error);
        if (job.manifest) {
          try {
            await store.saveManifest(job.manifest);
          } catch {
            safeError = new Error(
              'The export stopped and its recovery progress could not be saved. Check local storage before retrying.',
            );
          }
        }
        post({
          type: 'error',
          message: safeError.message || 'The audiobook export stopped. You can try to resume it.',
        });
      })
      .finally(() => {
        for (const provider of job.providers ?? []) provider.cancelAll();
        if (activeJob === job) activeJob = undefined;
      });
    return;
  }
  if (!activeJob) return;
  if (message.type === 'pause') {
    activeJob.paused = true;
    return;
  }
  if (message.type === 'resume') {
    activeJob.paused = false;
    return;
  }
  activeJob.cancelled = true;
  activeJob.paused = false;
  for (const provider of activeJob.providers ?? []) provider.cancelAll();
};
