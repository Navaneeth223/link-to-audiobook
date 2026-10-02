import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, Pause, Play, X } from 'lucide-react';
import {
  estimateAudioSeconds,
  estimateExportBytes,
  estimateGenerationSeconds,
  sanitizeFileName,
  type AudioExportFormat,
  type AudioExportSettings,
  type ExportMetadata,
} from '../core/audioExport';
import { documentFingerprint } from '../core/bookmarks';
import { AudioExportStore, type AudioExportManifest } from '../core/audioExportStore';
import { registerActiveExport, registerGeneratedAudioCleanup } from '../core/audioExportRegistry';
import { splitSentences, type Story } from '../core/document';
import { PIPER_VOICE, PiperSpeechProvider } from '../core/piper';
import type { VolumePreferences } from '../core/volumePreferences';

type ExportProgress = {
  state: 'preparing' | 'downloading-voice' | 'generating' | 'paused' | 'assembling';
  percent: number;
  completedChunks: number;
  totalChunks: number;
  chapterIndex: number;
  chunkIndex: number;
  elapsedMs: number;
  etaSeconds: number;
  chapters: Array<{ title: string; status: 'queued' | 'generating' | 'done' | 'failed' }>;
  voiceLoaded?: number;
  voiceTotal?: number;
};

type WorkerResponse =
  | ({ type: 'progress' } & ExportProgress)
  | {
      type: 'done';
      jobId: string;
      fileName: string;
      durationSeconds: number;
      sizeBytes: number;
      savedDirectly: boolean;
      previewFileName?: string;
    }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };
type ExportWorker = Worker & { onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null };
type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
};

type Props = {
  story: Story;
  currentChapterIndex: number;
  speed: number;
  volume: VolumePreferences;
};

function useElement(selector: string): Element | null {
  const subscribe = useCallback((notify: () => void) => {
    const observer = new MutationObserver(notify);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const getSnapshot = useCallback(() => document.querySelector(selector), [selector]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.ceil(bytes / 1_000_000)} MB`;
  return `${Math.ceil(bytes / 1_000)} KB`;
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remaining = rounded % 60;
  return hours ? `${hours} hr ${minutes} min` : minutes ? `${minutes} min` : `${remaining} sec`;
}

function filePickerOptions(title: string, format: AudioExportFormat) {
  const safeTitle = sanitizeFileName(title);
  if (format === 'wav') {
    return {
      suggestedName: `${safeTitle}.wav`,
      types: [{ description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } }],
    };
  }
  if (format === 'mp3-chapters') {
    return {
      suggestedName: `${safeTitle}.mp3`,
      types: [{ description: 'MP3 audio', accept: { 'audio/mpeg': ['.mp3'] } }],
    };
  }
  return {
    suggestedName: `${safeTitle}.zip`,
    types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
  };
}

export function AudiobookExportDialog({ story, currentChapterIndex, speed, volume }: Props) {
  const appTarget = useElement('.app');
  const headerTarget = useElement('.top-actions');
  const playerMenuTarget = useElement('.more-skips-menu');
  const [view, setView] = useState<'configure' | 'progress' | 'finished' | null>(null);
  const [format, setFormat] = useState<AudioExportFormat>('mp3-zip');
  const [bitrate, setBitrate] = useState<64 | 96 | 128>(96);
  const [exportSpeed, setExportSpeed] = useState(speed);
  const [exportVolume, setExportVolume] = useState(volume.muted ? 0 : volume.volume);
  const [pauseBetweenParagraphsMs, setPauseBetweenParagraphsMs] = useState(350);
  const [pauseBetweenChaptersMs, setPauseBetweenChaptersMs] = useState(1_000);
  const [selected, setSelected] = useState<number[]>(story.chapters.map((_, index) => index));
  const [title, setTitle] = useState(story.title);
  const [author, setAuthor] = useState('');
  const [consented, setConsented] = useState(false);
  const [voiceSelected, setVoiceSelected] = useState(false);
  const storageAvailable = typeof navigator.storage?.getDirectory === 'function';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<Extract<WorkerResponse, { type: 'done' }> | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [savedLocationName, setSavedLocationName] = useState('');
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [measuredSpeed, setMeasuredSpeed] = useState<number | undefined>();
  const [benchmarkStatus, setBenchmarkStatus] = useState('');
  const [resumeCandidate, setResumeCandidate] = useState<AudioExportManifest | null>(null);
  const [checkingResume, setCheckingResume] = useState(false);
  const [resumeNotice, setResumeNotice] = useState('');
  const workerRef = useRef<ExportWorker | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const saveHandleRef = useRef<FileSystemFileHandle | undefined>(undefined);
  const previewUrlRef = useRef('');
  const downloadUrlRef = useRef('');
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const cancelWaiterRef = useRef<(() => void) | null>(null);
  const unregisterCancelRef = useRef<(() => void) | null>(null);

  const selectedSeconds = estimateAudioSeconds(story, selected);
  const estimatedSize = estimateExportBytes(selectedSeconds, format, bitrate);
  const generationSeconds = estimateGenerationSeconds(selectedSeconds, measuredSpeed ?? 4);
  const durationLimitExceeded = selectedSeconds > 10 * 60 * 60;
  const titleForFile = title.trim() || story.title;
  const launch = () => {
    const nextView = workerRef.current ? 'progress' : result ? 'finished' : 'configure';
    setView(nextView);
    if (nextView !== 'configure') return;
    setCheckingResume(true);
    setResumeCandidate(null);
    void new AudioExportStore()
      .listManifests()
      .then((manifests) => {
        const fingerprint = documentFingerprint(story);
        const candidate = manifests
          .filter(
            (manifest) =>
              manifest.documentFingerprint === fingerprint &&
              manifest.voiceId === PIPER_VOICE.id &&
              manifest.state !== 'complete' &&
              manifest.settings.chapters.length > 0 &&
              manifest.settings.chapters.every((index) => index < story.chapters.length),
          )
          .sort((left, right) => right.updatedAt - left.updatedAt)[0];
        setResumeCandidate(candidate ?? null);
      })
      .catch(() => setError('The browser could not check for interrupted audiobook exports.'))
      .finally(() => setCheckingResume(false));
  };

  const restoreResumeSettings = () => {
    if (!resumeCandidate) return;
    const { settings, metadata } = resumeCandidate;
    setFormat(settings.format);
    setBitrate(settings.bitrate);
    setExportSpeed(settings.speed);
    setExportVolume(settings.volume);
    setPauseBetweenParagraphsMs(settings.pauseBetweenParagraphsMs);
    setPauseBetweenChaptersMs(settings.pauseBetweenChaptersMs);
    setSelected(settings.chapters);
    setTitle(metadata.title);
    setAuthor(metadata.author === 'Unknown author' ? '' : metadata.author);
    setVoiceSelected(true);
    setConsented(false);
    setResumeNotice(
      'Review the restored settings, acknowledge the personal-use notice, then start to resume.',
    );
  };
  const toggleChapter = (index: number) =>
    setSelected((current) =>
      current.includes(index)
        ? current.filter((chapter) => chapter !== index)
        : [...current, index].sort((a, b) => a - b),
    );

  const releaseWakeLock = useCallback(() => {
    void wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }, []);

  const clearGeneratedAudio = useCallback(() => {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    setPreviewPlaying(false);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
    previewUrlRef.current = '';
    downloadUrlRef.current = '';
    setPreviewUrl('');
    setDownloadUrl('');
    setResult(null);
    setView(null);
  }, []);

  const closeFinishedExport = useCallback(async () => {
    try {
      if (result) await new AudioExportStore().deleteJob(result.jobId);
      setError('');
      clearGeneratedAudio();
    } catch {
      setError(
        'Temporary export files could not be removed. Use Delete generated audio or Clear everything to try again.',
      );
    }
  }, [clearGeneratedAudio, result]);

  useEffect(() => registerGeneratedAudioCleanup(clearGeneratedAudio), [clearGeneratedAudio]);

  const closeWorker = () => {
    cancelWaiterRef.current?.();
    workerRef.current?.terminate();
    workerRef.current = null;
    unregisterCancelRef.current?.();
    unregisterCancelRef.current = null;
    releaseWakeLock();
    setBusy(false);
  };

  const cancelAndWait = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const worker = workerRef.current;
        if (!worker) {
          resolve();
          return;
        }
        const timeout = window.setTimeout(() => {
          if (cancelWaiterRef.current !== finish) return;
          worker.terminate();
          workerRef.current = null;
          unregisterCancelRef.current?.();
          unregisterCancelRef.current = null;
          releaseWakeLock();
          setBusy(false);
          setError(
            'Cancellation took too long to confirm. Some temporary data may remain; use Clear everything to remove it.',
          );
          cancelWaiterRef.current = null;
          resolve();
        }, 10_000);
        const finish = () => {
          window.clearTimeout(timeout);
          cancelWaiterRef.current = null;
          resolve();
        };
        cancelWaiterRef.current = finish;
        worker.postMessage({ type: 'cancel' });
      }),
    [releaseWakeLock],
  );

  useEffect(
    () => () => {
      if (workerRef.current) void cancelAndWait();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
      previewAudioRef.current?.pause();
    },
    [cancelAndWait],
  );

  useEffect(() => {
    if (!view) return;
    const dialog = document.querySelector<HTMLElement>('.audiobook-dialog');
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [];
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (view === 'finished') void closeFinishedExport();
        else setView(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [closeFinishedExport, view]);

  const acquireWakeLock = async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
    } catch {
      wakeLockRef.current = null;
    }
  };

  const measureDevice = async () => {
    const firstPassage = selected
      .flatMap((chapterIndex) => story.chapters[chapterIndex]?.paragraphs ?? [])
      .flatMap((paragraph) => splitSentences(paragraph.text))
      .slice(0, 3)
      .join(' ');
    if (!firstPassage) {
      setError('Select a chapter with text before measuring generation speed.');
      return;
    }
    const provider = new PiperSpeechProvider();
    provider.setSpeed(exportSpeed);
    setBusy(true);
    setError('');
    setBenchmarkStatus('Checking the downloadable voice…');
    try {
      if (!(await provider.isVoiceInstalled())) {
        setBenchmarkStatus(`Downloading the ${formatBytes(PIPER_VOICE.modelBytes)} voice model…`);
        await provider.downloadVoice((loaded, total) => {
          setBenchmarkStatus(`Downloading voice model · ${Math.floor((loaded / total) * 100)}%`);
        });
      }
      setBenchmarkStatus('Measuring a few sentences on this device…');
      const started = performance.now();
      const audio = await provider.synthesize(firstPassage);
      const audioSeconds = audio.samples.length / audio.sampleRate;
      setMeasuredSpeed(Math.max(0.01, (performance.now() - started) / 1_000 / audioSeconds));
      setBenchmarkStatus('Measurement complete. The estimate uses this device’s result.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This device could not measure voice generation.');
      setBenchmarkStatus('');
    } finally {
      provider.cancelAll();
      setBusy(false);
    }
  };

  const startExport = async () => {
    if (!consented || !voiceSelected || !selected.length || !storageAvailable || durationLimitExceeded)
      return;
    setError('');
    let saveHandle: FileSystemFileHandle | undefined;
    const picker = (window as SavePickerWindow).showSaveFilePicker;
    if (picker) {
      try {
        saveHandle = await picker(filePickerOptions(titleForFile, format));
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError('The save location could not be opened. Choose another location or try again.');
        return;
      }
    }

    const settings: AudioExportSettings = {
      format,
      bitrate,
      speed: exportSpeed,
      volume: exportVolume,
      pauseBetweenParagraphsMs,
      pauseBetweenChaptersMs,
      chapters: [...selected],
    };
    const metadata: ExportMetadata = { title: titleForFile, author, voice: PIPER_VOICE.name };
    try {
      const worker = new Worker(new URL('../core/audiobookExport.worker.ts', import.meta.url), {
        type: 'module',
      }) as ExportWorker;
      workerRef.current = worker;
      unregisterCancelRef.current = registerActiveExport(cancelAndWait);
      saveHandleRef.current = saveHandle;
      setSavedLocationName(saveHandle?.name ?? '');
      setBusy(true);
      setView('progress');
      setProgress(null);
      await acquireWakeLock();
      worker.onmessage = (event) => {
        const message = event.data;
        if (message.type === 'progress') {
          setProgress(message);
          return;
        }
        if (message.type === 'done') {
          closeWorker();
          setResult(message);
          void (async () => {
            const saveHandle = saveHandleRef.current;
            const previewFileName = message.previewFileName ?? message.fileName;
            const store = new AudioExportStore();
            const directory = await store.getJobDirectory(message.jobId);
            const outputFile =
              message.savedDirectly && saveHandle
                ? await saveHandle.getFile()
                : await store.readFile(directory, message.fileName);
            const previewFile =
              message.savedDirectly && saveHandle && previewFileName === message.fileName
                ? outputFile
                : await store.readFile(directory, previewFileName);
            if (!outputFile || !previewFile) {
              setError('The finished audio file could not be opened from local storage.');
              return;
            }
            const outputUrl = URL.createObjectURL(outputFile);
            const previewUrl = URL.createObjectURL(previewFile);
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
            if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
            previewUrlRef.current = previewUrl;
            downloadUrlRef.current = outputUrl;
            setPreviewUrl(previewUrl);
            setDownloadUrl(outputUrl);
            setView('finished');
          })().catch(() => setError('The finished audio file could not be opened from local storage.'));
          return;
        }
        if (message.type === 'cancelled') {
          cancelWaiterRef.current?.();
          closeWorker();
          setProgress(null);
          setError('Export cancelled. Temporary audio was removed.');
          setView('configure');
          return;
        }
        if (message.type === 'error') {
          cancelWaiterRef.current?.();
          closeWorker();
          setError(message.message);
          setView('progress');
        }
      };
      worker.onerror = () => {
        closeWorker();
        setError('The export worker stopped unexpectedly. You can try to resume the export.');
      };
      worker.postMessage({ type: 'start', story, settings, metadata, saveHandle });
    } catch {
      closeWorker();
      setError('The audiobook worker could not start in this browser.');
    }
  };

  const cancelExport = () => void cancelAndWait();
  const pauseOrResume = () => {
    if (!progress || !workerRef.current) return;
    const next = progress.state === 'paused' ? 'resume' : 'pause';
    workerRef.current.postMessage({ type: next });
    if (next === 'resume') setProgress({ ...progress, state: 'generating' });
    else setProgress({ ...progress, state: 'paused' });
  };

  const removeGeneratedAudio = async () => {
    try {
      if (!result) return;
      await new AudioExportStore().deleteJob(result.jobId);
      clearGeneratedAudio();
      setError('Generated audio and resumable export data were removed from this browser.');
      setView('configure');
    } catch {
      setError('Some generated audio could not be removed. Use Clear everything to try again.');
    }
  };

  const exportAnotherFormat = async () => {
    try {
      if (result) await new AudioExportStore().deleteJob(result.jobId, false);
      setError('');
      clearGeneratedAudio();
      setView('configure');
    } catch {
      setError('The previous temporary files could not be removed. Delete generated audio or Clear everything before continuing.');
    }
  };

  const togglePreview = async () => {
    if (!previewUrl) return;
    let audio = previewAudioRef.current;
    if (!audio || audio.src !== previewUrl) {
      audio = new Audio(previewUrl);
      audio.addEventListener('ended', () => setPreviewPlaying(false), { once: true });
      audio.addEventListener(
        'error',
        () => {
          setPreviewPlaying(false);
          setError('This browser could not play the preview audio.');
        },
        { once: true },
      );
      previewAudioRef.current = audio;
    }
    if (audio.paused) {
      try {
        await audio.play();
        setPreviewPlaying(true);
      } catch {
        setError('This browser could not start the preview audio.');
      }
    } else {
      audio.pause();
      setPreviewPlaying(false);
    }
  };

  const downloadButton = (className: string) => (
    <button className={className} type="button" onClick={launch} aria-label="Download audiobook">
      <Download size={15} />
      <span>{busy ? `Export running · ${progress?.percent ?? 0}%` : 'Download audiobook'}</span>
    </button>
  );

  const selectedEstimate = selectedSeconds > 0 ? formatDuration(selectedSeconds) : '—';
  const viewContent =
    view === 'configure' ? (
      <section className="audiobook-dialog" role="dialog" aria-modal="true" aria-labelledby="audiobook-title">
        <div className="dialog-head">
          <div>
            <span className="dialog-kicker">PRIVATE, ON-DEVICE AUDIO</span>
            <h2 id="audiobook-title">Create audiobook</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => setView(null)}
            aria-label="Close audiobook export"
          >
            <X size={18} />
          </button>
        </div>
        <div className="audiobook-form">
          {checkingResume && (
            <p className="audiobook-status" role="status">
              Checking for an interrupted export…
            </p>
          )}
          {resumeCandidate && (
            <div className="audiobook-browser-note">
              <p>
                An unfinished export from {new Date(resumeCandidate.updatedAt).toLocaleString()} can be
                resumed using its saved audio chunks.
              </p>
              <button className="secondary-button" type="button" onClick={restoreResumeSettings}>
                Restore settings to resume
              </button>
            </div>
          )}
          {resumeNotice && (
            <p className="audiobook-status" role="status">
              {resumeNotice}
            </p>
          )}
          <label className="audiobook-field">
            <span>Voice</span>
            <select
              value={voiceSelected ? PIPER_VOICE.id : 'browser'}
              onChange={(event) => setVoiceSelected(event.target.value === PIPER_VOICE.id)}
            >
              <option value="browser" disabled>
                Browser voice · not downloadable
              </option>
              <option value={PIPER_VOICE.id}>{PIPER_VOICE.name} · Downloadable</option>
            </select>
          </label>
          {!voiceSelected && (
            <div className="audiobook-browser-note" role="status">
              <p>Browser and operating-system voices cannot provide audio samples for file export.</p>
              <button className="secondary-button" type="button" onClick={() => setVoiceSelected(true)}>
                Switch to a downloadable voice
              </button>
            </div>
          )}
          {voiceSelected && (
            <div className="audiobook-voice-note">
              <span className="downloadable-badge">DOWNLOADABLE</span>
              <span>Voice model · about {formatBytes(PIPER_VOICE.modelBytes)} stored on this device</span>
              <p>
                Generation speed varies by device. The voice model downloads from a public open-source model
                host.
              </p>
            </div>
          )}

          <div className="audiobook-two-column">
            <label className="audiobook-field">
              <span>Format</span>
              <select value={format} onChange={(event) => setFormat(event.target.value as AudioExportFormat)}>
                <option value="mp3-zip">MP3 by chapter (ZIP)</option>
                <option value="mp3-chapters">Single MP3 with chapters</option>
                <option value="wav">WAV · lossless, large</option>
              </select>
            </label>
            {format !== 'wav' && (
              <label className="audiobook-field">
                <span>MP3 quality</span>
                <select
                  value={bitrate}
                  onChange={(event) => setBitrate(Number(event.target.value) as 64 | 96 | 128)}
                >
                  <option value={64}>64 kbps · smallest</option>
                  <option value={96}>96 kbps · balanced</option>
                  <option value={128}>128 kbps · higher quality</option>
                </select>
              </label>
            )}
          </div>
          <p className="audiobook-estimates">
            {selectedEstimate} audio · about {formatBytes(estimatedSize)} · estimated generation{' '}
            {formatDuration(generationSeconds)}
            {measuredSpeed ? ' on this device' : ' (rough estimate)'}
          </p>
          {format === 'wav' && (
            <p className="audiobook-warning">
              WAV is about 170 MB per hour at 24 kHz, before local working space.
            </p>
          )}
          <button
            className="text-action"
            type="button"
            onClick={() => void measureDevice()}
            disabled={busy || !voiceSelected}
          >
            {busy ? benchmarkStatus || 'Working…' : 'Measure generation speed on this device'}
          </button>
          {benchmarkStatus && (
            <p className="audiobook-status" role="status">
              {benchmarkStatus}
            </p>
          )}

          <label className="audiobook-field">
            <span>Narration speed · {exportSpeed.toFixed(2)}×</span>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              value={exportSpeed}
              onChange={(event) => setExportSpeed(Number(event.target.value))}
              aria-label="Export narration speed"
            />
          </label>
          <label className="audiobook-field">
            <span>Export volume · {Math.round(exportVolume * 100)}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={exportVolume}
              onChange={(event) => setExportVolume(Number(event.target.value))}
              aria-label="Export audio volume"
            />
          </label>
          <label className="audiobook-field">
            <span>Pause between paragraphs · {pauseBetweenParagraphsMs} ms</span>
            <input
              type="range"
              min="0"
              max="1000"
              step="50"
              value={pauseBetweenParagraphsMs}
              onChange={(event) => setPauseBetweenParagraphsMs(Number(event.target.value))}
              aria-label="Pause between paragraphs"
            />
          </label>
          <label className="audiobook-field">
            <span>Pause between chapters · {pauseBetweenChaptersMs} ms</span>
            <input
              type="range"
              min="0"
              max="3000"
              step="100"
              value={pauseBetweenChaptersMs}
              onChange={(event) => setPauseBetweenChaptersMs(Number(event.target.value))}
              aria-label="Pause between chapters"
            />
          </label>

          <fieldset className="audiobook-chapters">
            <legend>Chapters · {selected.length} selected</legend>
            <div className="chapter-selection-actions">
              <button
                type="button"
                className="text-action"
                onClick={() => setSelected(story.chapters.map((_, index) => index))}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-action"
                onClick={() => setSelected([currentChapterIndex])}
              >
                Current chapter only
              </button>
            </div>
            <div className="audiobook-chapter-list">
              {story.chapters.map((chapter, index) => (
                <label key={chapter.id} className="audiobook-chapter-choice">
                  <input
                    type="checkbox"
                    checked={selected.includes(index)}
                    onChange={() => toggleChapter(index)}
                  />
                  <span>{chapter.title}</span>
                  <small>
                    {formatDuration(estimateAudioSeconds(story, [index]))} ·{' '}
                    {formatBytes(estimateExportBytes(estimateAudioSeconds(story, [index]), format, bitrate))}
                  </small>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="audiobook-two-column">
            <label className="audiobook-field">
              <span>Title</span>
              <input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="audiobook-field">
              <span>Author</span>
              <input
                value={author}
                maxLength={160}
                onChange={(event) => setAuthor(event.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>
          <div className="audiobook-notice">
            For personal listening. You are responsible for having the right to convert this document. Do not
            redistribute content you don’t own.
          </div>
          <label className="audiobook-consent">
            <input
              type="checkbox"
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
            />
            <span>
              I have the right to convert this document and will use the export for personal listening.
            </span>
          </label>
          {!storageAvailable && (
            <p className="audiobook-error" role="alert">
              This browser does not provide the local file storage required for resumable exports.
            </p>
          )}
          {durationLimitExceeded && (
            <p className="audiobook-error" role="alert">
              This selection exceeds the 10-hour limit. Select fewer chapters.
            </p>
          )}
          {error && (
            <p className="audiobook-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-footer audiobook-footer">
            <button className="secondary-button" type="button" onClick={() => setView(null)}>
              Cancel
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void startExport()}
              disabled={
                !consented ||
                !voiceSelected ||
                !selected.length ||
                !storageAvailable ||
                durationLimitExceeded ||
                busy
              }
            >
              Start export <Download size={15} />
            </button>
          </div>
        </div>
      </section>
    ) : view === 'progress' ? (
      <section
        className="audiobook-dialog audiobook-progress"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audiobook-progress-title"
      >
        <div className="dialog-head">
          <div>
            <span className="dialog-kicker">KEEP THIS TAB OPEN</span>
            <h2 id="audiobook-progress-title">Creating your audiobook</h2>
          </div>
          {!busy && (
            <button
              className="icon-button"
              type="button"
              onClick={() => setView(null)}
              aria-label="Close export status"
            >
              <X size={18} />
            </button>
          )}
        </div>
        {error && (
          <p className="audiobook-error" role="alert">
            {error}
          </p>
        )}
        <p className="audiobook-status" role="status">
          {progress?.state === 'downloading-voice'
            ? progress.voiceTotal
              ? `Downloading voice · ${Math.floor(((progress.voiceLoaded ?? 0) / progress.voiceTotal) * 100)}%`
              : 'Preparing the downloadable voice…'
            : progress?.state === 'paused'
              ? 'Export paused'
              : progress?.state === 'assembling'
                ? 'Assembling the audiobook…'
                : `Generating audio · ${progress?.completedChunks ?? 0} of ${progress?.totalChunks ?? 0} audio chunks`}
        </p>
        {progress?.state === 'downloading-voice' && progress.voiceTotal ? (
          <progress
            className="audiobook-progress-bar"
            max={progress.voiceTotal}
            value={progress.voiceLoaded ?? 0}
            aria-label="Voice download progress"
          />
        ) : (
          <progress
            className="audiobook-progress-bar"
            max={100}
            value={progress?.percent ?? 0}
            aria-label="Audiobook export progress"
          />
        )}
        <div className="audiobook-progress-meta">
          <span>{progress?.percent ?? 0}% complete</span>
          <span>Elapsed {formatDuration((progress?.elapsedMs ?? 0) / 1_000)}</span>
          <span>About {formatDuration(progress?.etaSeconds ?? generationSeconds)} remaining</span>
        </div>
        <ul className="audiobook-progress-chapters">
          {(
            progress?.chapters ??
            story.chapters
              .filter((_, index) => selected.includes(index))
              .map((chapter) => ({
                title: chapter.title,
                status: 'queued' as const,
              }))
          ).map((chapter) => (
            <li key={chapter.title} data-status={chapter.status}>
              <span>{chapter.title}</span>
              <span>
                {chapter.status === 'done'
                  ? 'Done'
                  : chapter.status === 'failed'
                    ? 'Needs retry'
                    : chapter.status === 'generating'
                      ? 'Generating'
                      : 'Queued'}
              </span>
            </li>
          ))}
        </ul>
        <p className="audiobook-keep-open">
          The story and generated audio stay on this device. You can continue reading while this runs.
        </p>
        <div className="dialog-footer audiobook-footer">
          {busy ? (
            <>
              <button
                className="secondary-button"
                type="button"
                onClick={pauseOrResume}
                disabled={progress?.state === 'downloading-voice'}
                title={
                  progress?.state === 'downloading-voice'
                    ? 'Pause is available after the voice downloads.'
                    : undefined
                }
              >
                {progress?.state === 'paused' ? <Play size={14} /> : <Pause size={14} />}
                {progress?.state === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button className="danger-button" type="button" onClick={cancelExport}>
                Cancel export
              </button>
              <button className="text-action" type="button" onClick={() => setView(null)}>
                Continue reading
              </button>
            </>
          ) : (
            <button className="primary-button" type="button" onClick={() => setView('configure')}>
              Try again
            </button>
          )}
        </div>
      </section>
    ) : view === 'finished' && result ? (
      <section
        className="audiobook-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audiobook-finished-title"
      >
        <div className="dialog-head">
          <div>
            <span className="dialog-kicker">READY FOR YOUR LISTENING ROOM</span>
            <h2 id="audiobook-finished-title">Audiobook complete</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => void closeFinishedExport()}
            aria-label="Close finished export"
          >
            <X size={18} />
          </button>
        </div>
        <p className="audiobook-status">
          {result.savedDirectly
            ? `Saved to ${savedLocationName || result.fileName}`
            : `${result.fileName} · ${formatBytes(result.sizeBytes)}`}
        </p>
        {error && (
          <p className="audiobook-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="secondary-button audiobook-preview"
          type="button"
          onClick={() => void togglePreview()}
        >
          {previewPlaying ? <Pause size={15} /> : <Play size={15} />}
          {previewPlaying ? 'Pause preview' : 'Play from file'}
        </button>
        {!result.savedDirectly && (
          <a className="primary-button audiobook-download-link" href={downloadUrl} download={result.fileName}>
            Download audiobook <Download size={15} />
          </a>
        )}
        <div className="dialog-footer audiobook-footer">
          <button className="secondary-button" type="button" onClick={() => void exportAnotherFormat()}>
            Export another format
          </button>
          <button className="danger-button" type="button" onClick={() => void removeGeneratedAudio()}>
            Delete generated audio
          </button>
          <button className="primary-button" type="button" onClick={() => void closeFinishedExport()}>
            <Check size={15} /> Done
          </button>
        </div>
      </section>
    ) : null;

  return (
    <>
      {headerTarget && createPortal(downloadButton('audiobook-launcher reader-tool'), headerTarget)}
      {playerMenuTarget && createPortal(downloadButton('audiobook-menu-action'), playerMenuTarget)}
      {view &&
        appTarget &&
        createPortal(<div className="overlay audiobook-overlay">{viewContent}</div>, appTarget)}
    </>
  );
}
