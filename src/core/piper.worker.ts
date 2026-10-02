/// <reference lib="webworker" />

import {
  piperLengthScale,
  PIPER_MODEL_COMMIT,
  PIPER_ONNX_VERSION,
  PIPER_PHONEMIZER_VERSION,
  PIPER_STORAGE_DIRECTORY,
  PIPER_VOICE,
  filterPiperPhonemeIds,
  pinnedPiperModelUrl,
  sanitizeSpeechInput,
  type PiperWorkerRequest,
  type PiperWorkerResponse,
} from './piper';

const scope = self as DedicatedWorkerGlobalScope;
const basePath = `en/en_US/libritts/high/`;
const modelBase = `https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_MODEL_COMMIT}/${basePath}`;
const modelFiles = [
  { name: 'en_US-libritts-high.onnx', bytes: PIPER_VOICE.modelBytes },
  { name: 'en_US-libritts-high.onnx.json', bytes: PIPER_VOICE.configBytes },
] as const;
const modelMarker = '.psr-libritts-high.commit';
const baseConfigMarker = '.psr-libritts-high.base.json';
const onnxWasm = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${PIPER_ONNX_VERSION}/dist/`;
const piperWasmBase = `https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@${PIPER_PHONEMIZER_VERSION}/build/piper_phonemize`;
const controllers = new Map<number, AbortController>();
let piperSession: import('@mintplex-labs/piper-tts-web').TtsSession | undefined;
let sessionSpeed: number | undefined;
let validPhonemeIds = new Set<number>();
let phonemeGuardInstalled = false;

const nativeFetch = scope.fetch.bind(scope);
scope.fetch = (input, init) => {
  const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
  const pinnedUrl = pinnedPiperModelUrl(request.url);
  if (pinnedUrl) {
    return nativeFetch(
      new Request(new Request(pinnedUrl, request), { cache: 'no-store', credentials: 'omit' }),
    );
  }
  if (new URL(request.url).origin !== scope.location.origin) {
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

async function hasVoiceFiles(directory: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const marker = await directory.getFileHandle(modelMarker);
    if ((await (await marker.getFile()).text()).trim() !== PIPER_MODEL_COMMIT) return false;
  } catch (error) {
    if (notFound(error)) return false;
    throw error;
  }
  for (const modelFile of modelFiles) {
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
  fileName: string,
  expectedBytes: number,
  loadedBefore: number,
  totalBytes: number,
  requestId: number,
  signal: AbortSignal,
): Promise<number> {
  const url = `${modelBase}${fileName}`;
  const response = await nativeFetch(url, { signal, credentials: 'omit', cache: 'no-store' });
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

async function downloadVoice(requestId: number, signal: AbortSignal): Promise<void> {
  const directory = await getModelDirectory();
  const totalBytes = PIPER_VOICE.modelBytes + PIPER_VOICE.configBytes;
  if (await hasVoiceFiles(directory)) {
    post({ requestId, type: 'progress', loaded: totalBytes, total: totalBytes });
    return;
  }
  await removeIncompleteFile(directory, modelMarker);
  for (const file of modelFiles) await removeIncompleteFile(directory, file.name);
  const estimate = await navigator.storage.estimate();
  if (
    estimate.quota !== undefined &&
    estimate.usage !== undefined &&
    estimate.quota - estimate.usage < totalBytes
  ) {
    throw new Error('not-enough-space');
  }
  let loaded = 0;
  for (const file of modelFiles) {
    loaded = await downloadFile(directory, file.name, file.bytes, loaded, totalBytes, requestId, signal);
  }
  const markerHandle = await directory.getFileHandle(modelMarker, { create: true });
  const marker = await markerHandle.createWritable();
  try {
    await marker.write(PIPER_MODEL_COMMIT);
    await marker.close();
  } catch (error) {
    await marker.abort();
    await removeIncompleteFile(directory, modelMarker);
    throw error;
  }
}

async function readBaseConfig(directory: FileSystemDirectoryHandle): Promise<Record<string, unknown>> {
  const saved = await directory
    .getFileHandle(baseConfigMarker, { create: true })
    .then((handle) => handle.getFile());
  if (saved.size) return JSON.parse(await saved.text()) as Record<string, unknown>;
  const modelConfig = await directory.getFileHandle(modelFiles[1].name).then((handle) => handle.getFile());
  const config = JSON.parse(await modelConfig.text()) as Record<string, unknown>;
  await writeJsonFile(directory, baseConfigMarker, config);
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
): Promise<import('@mintplex-labs/piper-tts-web').TtsSession> {
  await downloadVoice(requestId, signal);
  if (piperSession && sessionSpeed === speed) return piperSession;
  const directory = await getModelDirectory();
  const config = await readBaseConfig(directory);
  const inference =
    config.inference && typeof config.inference === 'object'
      ? (config.inference as Record<string, unknown>)
      : undefined;
  const baseLengthScale = inference?.length_scale;
  if (typeof baseLengthScale !== 'number' || !Number.isFinite(baseLengthScale) || baseLengthScale <= 0) {
    throw new Error('The downloadable voice does not expose a supported speed setting.');
  }
  const configured = {
    ...config,
    inference: { ...inference, length_scale: piperLengthScale(baseLengthScale, speed) },
  };
  const phonemeMap = config.phoneme_id_map;
  if (!phonemeMap || typeof phonemeMap !== 'object') {
    throw new Error('synthesis-input-invalid');
  }
  validPhonemeIds = new Set(
    Object.values(phonemeMap as Record<string, unknown>)
      .filter(Array.isArray)
      .flatMap((ids) => ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id))),
  );
  if (!validPhonemeIds.size) throw new Error('synthesis-input-invalid');
  await installPhonemeGuard();
  await writeJsonFile(directory, modelFiles[1].name, configured);
  try {
    const { TtsSession } = await import('@mintplex-labs/piper-tts-web');
    TtsSession._instance = null;
    piperSession = await TtsSession.create({
      voiceId: PIPER_VOICE.id,
      wasmPaths: {
        onnxWasm,
        piperData: `${piperWasmBase}.data`,
        piperWasm: `${piperWasmBase}.wasm`,
      },
    });
    sessionSpeed = speed;
  } finally {
    await writeJsonFile(directory, modelFiles[1].name, config);
  }
  return piperSession;
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
  phonemeGuardInstalled = true;
}

function friendlyError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError')
    return 'The voice operation was cancelled.';
  if (error instanceof Error && error.message === 'not-enough-space')
    return 'Not enough free space to download this voice.';
  if (error instanceof Error && error.message === 'voice-size-mismatch')
    return 'The downloaded voice file was incomplete. Please try again.';
  if (error instanceof Error && error.message === 'voice-download-failed')
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
  if (error instanceof Error && /(?:network|fetch|http)/iu.test(error.message))
    return 'The voice files could not be downloaded. Check your connection, then try again.';
  return 'The voice could not synthesize this passage. The export will try a shorter sentence.';
}

async function handleRequest(request: PiperWorkerRequest): Promise<void> {
  if (request.type === 'cancel') {
    controllers.get(request.targetRequestId)?.abort();
    return;
  }
  const controller = new AbortController();
  controllers.set(request.requestId, controller);
  try {
    if (request.type === 'status') {
      post({
        requestId: request.requestId,
        type: 'status',
        installed: await hasVoiceFiles(await getModelDirectory()),
      });
    } else if (request.type === 'download') {
      await downloadVoice(request.requestId, controller.signal);
      post({ requestId: request.requestId, type: 'done' });
    } else if (request.type === 'remove') {
      const directory = await getModelDirectory();
      for (const file of modelFiles) await removeIncompleteFile(directory, file.name);
      await removeIncompleteFile(directory, modelMarker);
      await removeIncompleteFile(directory, baseConfigMarker);
      piperSession = undefined;
      sessionSpeed = undefined;
      post({ requestId: request.requestId, type: 'done' });
    } else if (request.type === 'synthesize') {
      const session = await getSession(request.requestId, controller.signal, request.speed);
      const text = sanitizeSpeechInput(request.text);
      if (!text) throw new Error('synthesis-input-invalid');
      const wav = await session.predict(text);
      const { decodePiperWav } = await import('./piper');
      const audio = decodePiperWav(await wav.arrayBuffer());
      const buffer = audio.samples.buffer;
      if (!(buffer instanceof ArrayBuffer))
        throw new Error('The voice engine returned unsupported audio memory.');
      post({ requestId: request.requestId, type: 'audio', audio }, [buffer]);
    }
  } catch (error) {
    post({ requestId: request.requestId, type: 'error', message: friendlyError(error) });
  } finally {
    controllers.delete(request.requestId);
  }
}

scope.onmessage = (event) => {
  void handleRequest(event.data as PiperWorkerRequest);
};
