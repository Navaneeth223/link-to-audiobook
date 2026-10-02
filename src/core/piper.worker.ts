/// <reference lib="webworker" />

import {
  piperLengthScale,
  DOWNLOADABLE_PIPER_VOICES,
  getPiperVoice,
  PIPER_MODEL_COMMIT,
  PIPER_PHONEMIZER_VERSION,
  PIPER_STORAGE_DIRECTORY,
  filterPiperPhonemeIds,
  pinnedPiperModelUrl,
  piperWasmThreadCount,
  sanitizeSpeechInput,
  type PiperWorkerRequest,
  type PiperWorkerResponse,
  type PiperExecutionMode,
  type PiperVoice,
} from './piper';
import type { InferenceSession } from 'onnxruntime-common';

const scope = self as DedicatedWorkerGlobalScope;
const modelBase = `https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_MODEL_COMMIT}/`;
const onnxWasm = `${scope.location.origin}/onnxruntime/`;
const piperWasmBase = `https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@${PIPER_PHONEMIZER_VERSION}/build/piper_phonemize`;
const controllers = new Map<number, AbortController>();
let piperSession: import('@mintplex-labs/piper-tts-web').TtsSession | undefined;
let sessionSpeed: number | undefined;
let sessionVoiceId: string | undefined;
let sessionExecutionMode: PiperExecutionMode | undefined;
let requestedExecutionMode: PiperExecutionMode = 'auto';
let forceCpuFallback = false;
let requestedThreadLimit = 1;
let activeBackend: 'cpu' | 'gpu' = 'cpu';
let gpuFallbackReason = '';
let validPhonemeIds = new Set<number>();
let phonemeGuardInstalled = false;
let webGpuGuardInstalled = false;
let currentStage = 'initialization';

function modelFiles(voice: PiperVoice): Array<{ name: string; bytes: number }> {
  return [
    { name: `${voice.path.split('/').at(-1)}.onnx`, bytes: voice.modelBytes },
    { name: `${voice.path.split('/').at(-1)}.onnx.json`, bytes: voice.configBytes },
  ];
}

function modelMarker(voice: PiperVoice): string {
  return `.psr-${voice.id}.commit`;
}

function baseConfigMarker(voice: PiperVoice): string {
  return `.psr-${voice.id}.base.json`;
}

const nativeFetch = scope.fetch.bind(scope);
scope.fetch = (input, init) => {
  const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
  const pinnedUrl = pinnedPiperModelUrl(request.url);
  const origin = new URL(request.url).origin;
  if (pinnedUrl) {
    return nativeFetch(
      new Request(new Request(pinnedUrl, request), { cache: 'no-store', credentials: 'omit' }),
    );
  }
  if (origin !== scope.location.origin) {
    return nativeFetch(new Request(request, { cache: 'no-store', credentials: 'omit' }));
  }
  return nativeFetch(request);
};

function post(message: PiperWorkerResponse, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer ?? []);
}

function notFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

async function getModelDirectory(): Promise<FileSystemDirectoryHandle> {
  if (typeof navigator.storage?.getDirectory !== 'function') {
    throw new Error('This browser does not support the local storage needed for downloadable voices.');
  }
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(PIPER_STORAGE_DIRECTORY, { create: true });
}

async function hasVoiceFiles(directory: FileSystemDirectoryHandle, voice: PiperVoice): Promise<boolean> {
  try {
    const marker = await directory.getFileHandle(modelMarker(voice));
    if ((await (await marker.getFile()).text()).trim() !== PIPER_MODEL_COMMIT) return false;
  } catch (error) {
    if (notFound(error)) return false;
    throw error;
  }
  for (const modelFile of modelFiles(voice)) {
    try {
      const file = await directory.getFileHandle(modelFile.name);
      if ((await file.getFile()).size !== modelFile.bytes) return false;
    } catch (error) {
      if (notFound(error)) return false;
      throw error;
    }
  }
  return true;
}

async function removeIncompleteFile(directory: FileSystemDirectoryHandle, fileName: string): Promise<void> {
  try {
    await directory.removeEntry(fileName);
  } catch (error) {
    if (!notFound(error)) throw error;
  }
}

async function downloadFile(
  directory: FileSystemDirectoryHandle,
  modelPath: string,
  fileName: string,
  expectedBytes: number,
  loadedBefore: number,
  totalBytes: number,
  requestId: number,
  signal: AbortSignal,
): Promise<number> {
  const url = `${modelBase}${modelPath}`;
  currentStage = 'voice-download';
  let response: Response;
  try {
    response = await nativeFetch(url, { signal, credentials: 'omit', cache: 'no-store' });
  } catch {
    throw new Error('voice-download-network-failed');
  }
  if (!response.ok || !response.body) throw new Error('voice-download-failed');
  const responseSize = Number(response.headers.get('Content-Length'));
  if (responseSize && responseSize !== expectedBytes) throw new Error('voice-size-mismatch');

  const file = await directory.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  const reader = response.body.getReader();
  let loaded = 0;
  let closed = false;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Download cancelled.', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      loaded += value.byteLength;
      post({ requestId, type: 'progress', loaded: loadedBefore + loaded, total: totalBytes });
    }
    await writable.close();
    closed = true;
    if (loaded !== expectedBytes || (await file.getFile()).size !== expectedBytes) {
      throw new Error('voice-size-mismatch');
    }
    return loadedBefore + loaded;
  } catch (error) {
    try {
      if (!closed) await writable.abort();
      await removeIncompleteFile(directory, fileName);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Could not clean up an incomplete voice model.');
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function downloadVoice(
  requestId: number,
  signal: AbortSignal,
  voice: PiperVoice,
): Promise<void> {
  const directory = await getModelDirectory();
  const files = modelFiles(voice);
  const marker = modelMarker(voice);
  const totalBytes = voice.modelBytes + voice.configBytes;
  if (await hasVoiceFiles(directory, voice)) {
    post({ requestId, type: 'progress', loaded: totalBytes, total: totalBytes });
    return;
  }
  await removeIncompleteFile(directory, marker);
  for (const file of files) await removeIncompleteFile(directory, file.name);
  const estimate = await navigator.storage.estimate();
  if (
    estimate.quota !== undefined &&
    estimate.usage !== undefined &&
    estimate.quota - estimate.usage < totalBytes
  ) {
    throw new Error('not-enough-space');
  }
  let loaded = 0;
  const filenamePrefix = voice.path.split('/').at(-1);
  if (!filenamePrefix) throw new Error('The selected voice model path is invalid.');
  for (const file of files) {
    const extension = file.name.slice(filenamePrefix.length);
    loaded = await downloadFile(
      directory,
      `${voice.path}${extension}`,
      file.name,
      file.bytes,
      loaded,
      totalBytes,
      requestId,
      signal,
    );
  }
  const markerHandle = await directory.getFileHandle(marker, { create: true });
  const markerWriter = await markerHandle.createWritable();
  try {
    await markerWriter.write(PIPER_MODEL_COMMIT);
    await markerWriter.close();
  } catch (error) {
    await markerWriter.abort();
    await removeIncompleteFile(directory, marker);
    throw error;
  }
}

async function readBaseConfig(
  directory: FileSystemDirectoryHandle,
  voice: PiperVoice,
): Promise<Record<string, unknown>> {
  const saved = await directory
    .getFileHandle(baseConfigMarker(voice), { create: true })
    .then((handle) => handle.getFile());
  if (saved.size) return JSON.parse(await saved.text()) as Record<string, unknown>;
  const configFile = modelFiles(voice)[1];
  if (!configFile) throw new Error('The selected voice is missing its configuration filename.');
  const modelConfig = await directory.getFileHandle(configFile.name).then((handle) => handle.getFile());
  const config = JSON.parse(await modelConfig.text()) as Record<string, unknown>;
  await writeJsonFile(directory, baseConfigMarker(voice), config);
  return config;
}

async function writeJsonFile(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  value: Record<string, unknown>,
): Promise<void> {
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(JSON.stringify(value));
    await writable.close();
  } catch (error) {
    await writable.abort();
    throw error;
  }
}

async function getSession(
  requestId: number,
  signal: AbortSignal,
  speed: number,
  voice: PiperVoice,
): Promise<import('@mintplex-labs/piper-tts-web').TtsSession> {
  const prepare = async (): Promise<import('@mintplex-labs/piper-tts-web').TtsSession> => {
    await downloadVoice(requestId, signal, voice);
    if (
      piperSession &&
      sessionSpeed === speed &&
      sessionVoiceId === voice.id &&
      sessionExecutionMode === requestedExecutionMode
    ) {
      return piperSession;
    }
    const directory = await getModelDirectory();
    currentStage = 'voice-config';
    const config = await readBaseConfig(directory, voice);
    const configFile = modelFiles(voice)[1];
    if (!configFile) throw new Error('The selected voice is missing its configuration filename.');
    const inference =
      config.inference && typeof config.inference === 'object'
        ? (config.inference as Record<string, unknown>)
        : undefined;
    const baseLengthScale = inference?.length_scale;
    if (
      typeof baseLengthScale !== 'number' ||
      !Number.isFinite(baseLengthScale) ||
      baseLengthScale <= 0
    ) {
      throw new Error('The downloadable voice does not expose a supported speed setting.');
    }
    const configured = {
      ...config,
      inference: { ...inference, length_scale: piperLengthScale(baseLengthScale, speed) },
    };
    const phonemeMap = config.phoneme_id_map;
    if (!phonemeMap || typeof phonemeMap !== 'object') throw new Error('synthesis-input-invalid');
    validPhonemeIds = new Set(
      Object.values(phonemeMap as Record<string, unknown>)
        .filter(Array.isArray)
        .flatMap((ids) => ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id))),
    );
    if (!validPhonemeIds.size) throw new Error('synthesis-input-invalid');
    currentStage = 'onnx-runtime';
    await installPhonemeGuard();
    await writeJsonFile(directory, configFile.name, configured);
    try {
      currentStage = 'piper-session';
      const { TtsSession } = await import('@mintplex-labs/piper-tts-web');
      TtsSession._instance = null;
      piperSession = await TtsSession.create({
        voiceId: voice.id,
        wasmPaths: {
          onnxWasm,
          piperData: `${piperWasmBase}.data`,
          piperWasm: `${piperWasmBase}.wasm`,
        },
      });
      sessionSpeed = speed;
      sessionVoiceId = voice.id;
      sessionExecutionMode = requestedExecutionMode;
    } finally {
      await writeJsonFile(directory, configFile.name, config);
    }
    return piperSession;
  };
  const locks = scope.navigator.locks;
  return locks
    ? locks.request(`private-story-reader-piper-${voice.id}`, prepare)
    : prepare();
}

async function installPhonemeGuard(): Promise<void> {
  if (phonemeGuardInstalled) return;
  const module = await import('onnxruntime-web/wasm');
  const runtime = 'default' in module && module.default ? module.default : module;
  type RuntimeFeeds = Record<string, import('onnxruntime-web/wasm').Tensor>;
  type RuntimeRun = (
    feeds: RuntimeFeeds,
    fetchesOrOptions?: unknown,
    options?: unknown,
  ) => Promise<unknown>;
  const sessionFactory = runtime.InferenceSession as typeof runtime.InferenceSession & {
    prototype: { run: RuntimeRun };
  };
  const wasmEnvironment = runtime.env.wasm;
  const threadLimit = Math.min(
    piperWasmThreadCount(scope.crossOriginIsolated, scope.navigator.hardwareConcurrency),
    requestedThreadLimit,
  );
  let configuredThreads = threadLimit;
  Object.defineProperty(wasmEnvironment, 'numThreads', {
    configurable: true,
    enumerable: true,
    get: () => configuredThreads,
    set: (requested: number) => {
      if (!scope.crossOriginIsolated) {
        configuredThreads = 1;
        return;
      }
      if (Number.isFinite(requested)) {
        configuredThreads = Math.max(1, Math.min(Math.floor(requested), threadLimit));
      }
    },
  });
  const originalRun = sessionFactory.prototype.run;
  sessionFactory.prototype.run = function (this: object, feeds, fetchesOrOptions, options) {
    const input = feeds.input;
    if (!input || input.type !== 'int64') {
      return originalRun.call(this, feeds, fetchesOrOptions, options);
    }
    const rawIds = Array.from(input.data as BigInt64Array, Number);
    const { ids, dropped } = filterPiperPhonemeIds(rawIds, validPhonemeIds);
    if (!ids.length) throw new Error('synthesis-input-invalid');
    if (!dropped) return originalRun.call(this, feeds, fetchesOrOptions, options);
    const safeFeeds = {
      ...feeds,
      input: new runtime.Tensor('int64', ids, [1, ids.length]),
      input_lengths: new runtime.Tensor('int64', [ids.length]),
    };
    return originalRun.call(this, safeFeeds, fetchesOrOptions, options);
  };
  type RuntimeSessionOptions = InferenceSession.SessionOptions;
  type RuntimeSessionCreator = (
    model: ArrayBufferLike,
    options?: RuntimeSessionOptions,
  ) => Promise<InferenceSession>;
  const originalCreate = sessionFactory.create.bind(sessionFactory) as RuntimeSessionCreator;
  Object.defineProperty(sessionFactory, 'create', {
    configurable: true,
    writable: true,
    value: async (model: ArrayBufferLike, options: RuntimeSessionOptions = {}) => {
    gpuFallbackReason = '';
    if (requestedExecutionMode !== 'cpu' && !forceCpuFallback && 'gpu' in scope.navigator) {
      try {
        const gpuModule = await import('onnxruntime-web/webgpu');
        const gpuRuntime = 'default' in gpuModule && gpuModule.default ? gpuModule.default : gpuModule;
        gpuRuntime.env.wasm.wasmPaths = onnxWasm;
        gpuRuntime.env.wasm.numThreads = threadLimit;
        if (!webGpuGuardInstalled) {
          const gpuFactory = gpuRuntime.InferenceSession as typeof gpuRuntime.InferenceSession & {
            prototype: { run: RuntimeRun };
          };
          const originalGpuRun = gpuFactory.prototype.run;
          gpuFactory.prototype.run = function (this: object, feeds, fetchesOrOptions, runOptions) {
            const input = feeds.input;
            if (!input || input.type !== 'int64') {
              return originalGpuRun.call(this, feeds, fetchesOrOptions, runOptions);
            }
            const rawIds = Array.from(input.data as BigInt64Array, Number);
            const { ids, dropped } = filterPiperPhonemeIds(rawIds, validPhonemeIds);
            if (!ids.length) throw new Error('synthesis-input-invalid');
            if (!dropped) return originalGpuRun.call(this, feeds, fetchesOrOptions, runOptions);
            const safeFeeds = {
              ...feeds,
              input: new gpuRuntime.Tensor('int64', ids, [1, ids.length]),
              input_lengths: new gpuRuntime.Tensor('int64', [ids.length]),
            };
            return originalGpuRun.call(this, safeFeeds, fetchesOrOptions, runOptions);
          };
          webGpuGuardInstalled = true;
        }
        const gpuSession = await gpuRuntime.InferenceSession.create(model, {
          ...options,
          executionProviders: ['webgpu'],
        });
        activeBackend = 'gpu';
        return gpuSession;
      } catch (error) {
        forceCpuFallback = true;
        gpuFallbackReason =
          error instanceof Error
            ? `GPU inference was unavailable (${error.name}). The CPU engine is being used.`
            : 'GPU inference was unavailable. The CPU engine is being used.';
      }
    }
    activeBackend = 'cpu';
      return originalCreate(model, { ...options, executionProviders: ['wasm'] });
    },
  });
  phonemeGuardInstalled = true;
}

function friendlyError(error: unknown, stage: string): string {
  if (error instanceof DOMException && error.name === 'AbortError')
    return 'The voice operation was cancelled.';
  if (error instanceof Error && error.message === 'not-enough-space')
    return 'Not enough free space to download this voice.';
  if (error instanceof Error && error.message === 'voice-size-mismatch')
    return 'The downloaded voice file was incomplete. Please try again.';
  if (error instanceof Error && error.message === 'voice-download-failed')
    return 'The voice download failed. Check your connection, then try again.';
  if (error instanceof Error && error.message === 'voice-download-network-failed')
    return 'The voice download failed. Check your connection, then try again.';
  if (error instanceof Error && error.message === 'synthesis-input-invalid')
    return 'This passage contains characters that this voice cannot process.';
  if (
    error instanceof Error &&
    /(?:out of memory|memory allocation|allocation failed)/iu.test(error.message)
  ) {
    return 'There is not enough memory to synthesize this passage. Close other tabs or export fewer chapters.';
  }
  if (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NotAllowedError')
  ) {
    return 'The browser could not store the voice files. Check available storage and site permissions.';
  }
  if (error instanceof Error && /(?:network|fetch|http)/iu.test(error.message)) {
    if (stage === 'voice-download')
      return 'The voice download failed. Check your connection, then try again.';
    if (stage === 'piper-session' || stage === 'onnx-runtime') {
      return 'The local voice engine could not be loaded. Check your connection and try again.';
    }
    return 'The downloadable voice could not complete this operation. Please try again.';
  }
  return 'The voice could not synthesize this passage. The export will try a shorter sentence.';
}

async function handleRequest(request: PiperWorkerRequest): Promise<void> {
  if (request.type === 'cancel') {
    controllers.get(request.targetRequestId)?.abort();
    return;
  }
  const controller = new AbortController();
  controllers.set(request.requestId, controller);
  currentStage = request.type;
  try {
    if (request.type === 'status') {
      const voice = getPiperVoice(request.voiceId);
      if (!voice) throw new Error('The selected downloadable voice is not available.');
      post({
        requestId: request.requestId,
        type: 'status',
        installed: await hasVoiceFiles(await getModelDirectory(), voice),
      });
    } else if (request.type === 'download') {
      const voice = getPiperVoice(request.voiceId);
      if (!voice) throw new Error('The selected downloadable voice is not available.');
      await downloadVoice(request.requestId, controller.signal, voice);
      post({ requestId: request.requestId, type: 'done' });
    } else if (request.type === 'remove') {
      const directory = await getModelDirectory();
      const voices = request.voiceId
        ? DOWNLOADABLE_PIPER_VOICES.filter((voice) => voice.id === request.voiceId)
        : DOWNLOADABLE_PIPER_VOICES;
      if (request.voiceId && !voices.length) {
        throw new Error('The selected downloadable voice is not available.');
      }
      for (const voice of voices) {
        for (const file of modelFiles(voice)) await removeIncompleteFile(directory, file.name);
        await removeIncompleteFile(directory, modelMarker(voice));
        await removeIncompleteFile(directory, baseConfigMarker(voice));
      }
      if (!request.voiceId || request.voiceId === sessionVoiceId) {
        piperSession = undefined;
        sessionSpeed = undefined;
        sessionVoiceId = undefined;
        sessionExecutionMode = undefined;
      }
      post({ requestId: request.requestId, type: 'done' });
    } else if (request.type === 'prepare' || request.type === 'synthesize') {
      requestedThreadLimit = Math.max(
        1,
        Math.min(
          piperWasmThreadCount(scope.crossOriginIsolated, scope.navigator.hardwareConcurrency),
          request.threadLimit,
        ),
      );
      if (requestedExecutionMode !== request.executionMode) {
        requestedExecutionMode = request.executionMode;
        forceCpuFallback = false;
        piperSession = undefined;
        sessionSpeed = undefined;
        sessionExecutionMode = undefined;
      }
      const voice = getPiperVoice(request.voiceId);
      if (!voice) throw new Error('The selected downloadable voice is not available.');
      if (sessionVoiceId !== voice.id) {
        piperSession = undefined;
        sessionSpeed = undefined;
        sessionExecutionMode = undefined;
      }
      const session = await getSession(request.requestId, controller.signal, request.speed, voice);
      if (request.type === 'prepare') {
        post({ requestId: request.requestId, type: 'done' });
        return;
      }
      const text = sanitizeSpeechInput(request.text);
      if (!text) throw new Error('synthesis-input-invalid');
      currentStage = 'synthesis-inference';
      let wav: Blob;
      try {
        wav = await session.predict(text);
      } catch (error) {
        if (activeBackend !== 'gpu') throw error;
        forceCpuFallback = true;
        gpuFallbackReason =
          error instanceof Error
            ? `GPU synthesis was unsupported (${error.name}). The CPU engine is being used.`
            : 'GPU synthesis was unsupported. The CPU engine is being used.';
        piperSession = undefined;
        sessionSpeed = undefined;
        sessionExecutionMode = undefined;
        const cpuSession = await getSession(request.requestId, controller.signal, request.speed, voice);
        wav = await cpuSession.predict(text);
      }
      const { decodePiperWav } = await import('./piper');
      const audio = decodePiperWav(await wav.arrayBuffer());
      const buffer = audio.samples.buffer;
      if (!(buffer instanceof ArrayBuffer))
        throw new Error('The voice engine returned unsupported audio memory.');
      post(
        {
          requestId: request.requestId,
          type: 'audio',
          audio,
          backend: activeBackend,
          ...(gpuFallbackReason ? { fallbackReason: gpuFallbackReason } : {}),
        },
        [buffer],
      );
    }
  } catch (error) {
    post({ requestId: request.requestId, type: 'error', message: friendlyError(error, currentStage) });
  } finally {
    controllers.delete(request.requestId);
  }
}

let operationQueue = Promise.resolve();
scope.onmessage = (event) => {
  const request = event.data as PiperWorkerRequest;
  if (request.type === 'cancel') {
    void handleRequest(request);
    return;
  }
  operationQueue = operationQueue.then(() => handleRequest(request));
};
