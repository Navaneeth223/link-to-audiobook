import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  Bookmark,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Coffee,
  Contrast,
  Menu,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  Search,
  Settings2,
  SkipBack,
  SkipForward,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { extractFile, splitSentences, type Story } from '../core/document';
import { apiFetch, apiUrl, responseErrorMessage } from '../core/http';
import {
  bookmarkStorageKey,
  documentFingerprint,
  loadBookmarks,
  migrateLegacyBookmarks,
  parseBookmarks,
  saveBookmarks,
  type Bookmark as StoredBookmark,
} from '../core/bookmarks';
import { BrowserSpeechProvider } from '../core/speech';
import {
  DEFAULT_VOLUME_PREFERENCES,
  loadVolumePreferences,
  saveVolumePreferences,
} from '../core/volumePreferences';
import { clearBrowserAppData, deleteStoredItem, listStoredItems, type StoredItem } from '../core/privacyData';
import { VolumeControl } from './VolumeControl';
import { parseDonationLinks } from '../core/donationLinks';
import { LegalDialog, type LegalPage } from './LegalDialog';
import { firstDroppedFile, hasFileDrag } from '../core/uploads';
import { AudiobookExportDialog } from './AudiobookExportDialog';
import { cancelRegisteredExport, clearRegisteredGeneratedAudio } from '../core/audioExportRegistry';
import { AudioExportStore, type AudioExportManifest } from '../core/audioExportStore';
import {
  DOWNLOADABLE_PIPER_VOICES,
  isPiperVoiceInstalled,
  PiperSpeechProvider,
} from '../core/piper';
import type { PiperVoice, PiperVoiceId } from '../core/piper';

const speeds = [0.5, 0.75, 1, 1.1, 1.25, 1.5, 1.75, 2];
type BookmarkEntry = StoredBookmark & { chapterIndex: number; paragraphIndex: number };
const storyKey = (story: Story) => `psr-position-${story.sourceName}-${story.text.length}`;
const bookmarksKey = (story: Story) => bookmarkStorageKey(documentFingerprint(story));
function loadValidBookmarks(value: unknown, fingerprint: string, story: Story): BookmarkEntry[] {
  return parseBookmarks(value, fingerprint, story).flatMap((bookmark) => {
    const chapterIndex = story.chapters.findIndex((chapter) => chapter.id === bookmark.chapterId);
    const paragraphIndex =
      chapterIndex < 0
        ? -1
        : story.chapters[chapterIndex].paragraphs.findIndex(
            (paragraph) => paragraph.id === bookmark.paragraphId,
          );
    return chapterIndex < 0 || paragraphIndex < 0 ? [] : [{ ...bookmark, chapterIndex, paragraphIndex }];
  });
}
function estimatePositionSeconds(story: Story, chapterIndex: number, paragraphIndex: number): number {
  const prior = story.chapters
    .slice(0, chapterIndex)
    .flatMap((chapter) => chapter.paragraphs)
    .concat(story.chapters[chapterIndex]?.paragraphs.slice(0, paragraphIndex) ?? []);
  const words = prior.reduce((sum, paragraph) => sum + paragraph.text.split(/\s+/).filter(Boolean).length, 0);
  return words ? Math.max(1, Math.round((words / 150) * 60)) : 0;
}
function formatEstimate(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function App() {
  const [story, setStory] = useState<Story | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [paragraphIndex, setParagraphIndex] = useState(0);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [apiStatus, setApiStatus] = useState('');
  const [volumePreferences, setVolumePreferences] = useState(loadVolumePreferences);
  const [speechRestart, setSpeechRestart] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [theme, setTheme] = useState<'light' | 'sepia' | 'dark' | 'high-contrast'>('sepia');
  const [fontSize, setFontSize] = useState(19);
  const [follow, setFollow] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [legalPage, setLegalPage] = useState<LegalPage | null>(null);
  const [resumePrompt, setResumePrompt] = useState<{
    fingerprint: string;
    chapterIndex: number;
    paragraphIndex: number;
    seconds: number;
  } | null>(null);
  const [privacyDataOpen, setPrivacyDataOpen] = useState(false);
  const [storedItems, setStoredItems] = useState<StoredItem[]>([]);
  const [storedExports, setStoredExports] = useState<AudioExportManifest[]>([]);
  const [downloadedVoices, setDownloadedVoices] = useState<PiperVoice[]>([]);
  const [storageDataError, setStorageDataError] = useState('');
  const [clearReport, setClearReport] = useState('');
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [link, setLink] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [moreSkips, setMoreSkips] = useState(false);
  const donationLinks = parseDonationLinks(import.meta.env.VITE_DONATION_LINKS);
  const fileRef = useRef<HTMLInputElement>(null);
  const bookmarkImportRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLParagraphElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chapterLinksRef = useRef<Array<HTMLButtonElement | null>>([]);
  const speechProvider = useRef(new BrowserSpeechProvider());
  const volumeRestartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipVolumePersist = useRef(false);
  const skipBookmarkPersist = useRef(false);
  const paragraphs = story?.chapters[chapterIndex]?.paragraphs ?? [];
  const sentences = splitSentences(paragraphs[paragraphIndex]?.text ?? '');
  const currentText = sentences[sentenceIndex] ?? '';
  const allParagraphs = useMemo(
    () =>
      story?.chapters.flatMap((chapter, ci) =>
        chapter.paragraphs.map((p, pi) => ({
          ...p,
          chapterIndex: ci,
          paragraphIndex: pi,
          chapterTitle: chapter.title,
        })),
      ) ?? [],
    [story],
  );
  const results = useMemo(
    () =>
      query.trim()
        ? allParagraphs.filter((p) => p.text.toLowerCase().includes(query.toLowerCase())).slice(0, 30)
        : [],
    [query, allParagraphs],
  );

  useEffect(() => {
    if (follow && playing) activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [chapterIndex, paragraphIndex, follow, playing]);
  useEffect(() => {
    chapterLinksRef.current[chapterIndex]?.scrollIntoView({ block: 'nearest' });
  }, [chapterIndex]);
  useEffect(() => {
    if (!story || (resumePrompt && resumePrompt.fingerprint === documentFingerprint(story))) return;
    localStorage.setItem(storyKey(story), JSON.stringify({ chapterIndex, paragraphIndex }));
  }, [story, chapterIndex, paragraphIndex, resumePrompt]);
  useEffect(() => {
    if (!story) return;
    if (skipBookmarkPersist.current) {
      skipBookmarkPersist.current = false;
      return;
    }
    saveBookmarks(documentFingerprint(story), bookmarks);
  }, [story, bookmarks]);
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    const preventBrowserFileOpen = (event: DragEvent) => {
      if (event.dataTransfer && hasFileDrag(event.dataTransfer)) event.preventDefault();
    };
    window.addEventListener('dragover', preventBrowserFileOpen);
    window.addEventListener('drop', preventBrowserFileOpen);
    return () => {
      window.removeEventListener('dragover', preventBrowserFileOpen);
      window.removeEventListener('drop', preventBrowserFileOpen);
    };
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('microsoftConnected') !== '1') return;
    window.history.replaceState({}, '', window.location.pathname);
    setBusy(true);
    void apiFetch('/api/documents/pending', { method: 'POST' })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(await responseErrorMessage(response, 'We couldn’t open this shared document.'));
        const name = decodeURIComponent(response.headers.get('X-Document-Name') || 'shared-story.txt');
        await onFile(new File([await response.blob()], name));
      })
      .catch((e) =>
        setError(
          e instanceof TypeError
            ? 'The reader API could not be reached. Start the API server and try again.'
            : e instanceof Error
              ? e.message
              : 'We couldn’t open this shared document.',
        ),
      )
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        toggleMute();
      } else if (event.code === 'Space') {
        event.preventDefault();
        togglePlay();
      } else if (event.key === 'ArrowLeft' && event.shiftKey) {
        event.preventDefault();
        moveChapter(-1);
      } else if (event.key === 'ArrowRight' && event.shiftKey) {
        event.preventDefault();
        moveChapter(1);
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowLeft') {
        event.preventDefault();
        moveParagraph(-1);
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowRight') {
        event.preventDefault();
        moveParagraph(1);
      } else if (event.key === 'ArrowLeft') moveSentence(-1);
      else if (event.key === 'ArrowRight') moveSentence(1);
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key === 'Escape') {
        setSearchOpen(false);
        setSettings(false);
        setConfirmClear(false);
        setSupportOpen(false);
        setDrawer(false);
        setMoreSkips(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    if (!playing || !currentText || !('speechSynthesis' in window)) return;
    speechProvider.current.setVolume(volumePreferences.muted ? 0 : volumePreferences.volume);
    const utterance = speechProvider.current.createUtterance(currentText, speed);
    utterance.onend = () => advanceSentence();
    utterance.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') return;
      setPlaying(false);
      setError('Speech playback was interrupted. Press play to try again.');
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    return () => {
      window.speechSynthesis.cancel();
    };
  }, [playing, chapterIndex, paragraphIndex, sentenceIndex, speed, story, speechRestart]);

  useEffect(() => {
    speechProvider.current.setVolume(volumePreferences.muted ? 0 : volumePreferences.volume);
    if (skipVolumePersist.current) skipVolumePersist.current = false;
    else saveVolumePreferences(volumePreferences);
    if (volumeRestartTimer.current) clearTimeout(volumeRestartTimer.current);
    if (playing) volumeRestartTimer.current = setTimeout(() => setSpeechRestart((value) => value + 1), 320);
    return () => {
      if (volumeRestartTimer.current) clearTimeout(volumeRestartTimer.current);
    };
  }, [volumePreferences]);

  function advanceParagraph() {
    if (!story) return;
    if (paragraphIndex < paragraphs.length - 1) {
      setParagraphIndex(paragraphIndex + 1);
      setSentenceIndex(0);
    } else if (chapterIndex < story.chapters.length - 1) {
      setChapterIndex(chapterIndex + 1);
      setParagraphIndex(0);
      setSentenceIndex(0);
    } else {
      setPlaying(false);
      setError('You’ve reached the end of the story.');
    }
  }
  function advanceSentence() {
    if (sentenceIndex < sentences.length - 1) setSentenceIndex(sentenceIndex + 1);
    else advanceParagraph();
  }
  function togglePlay() {
    if (!story) return;
    if (!('speechSynthesis' in window)) {
      setError('Browser speech is not available on this device. Try a browser with speech support.');
      return;
    }
    setError('');
    setPlaying((v) => !v);
  }
  function setVolume(value: number) {
    const next = Math.min(1, Math.max(0, value));
    setVolumePreferences((current) => ({
      ...current,
      volume: next,
      muted: next === 0,
      lastNonZero: next > 0 ? next : current.lastNonZero,
    }));
  }
  function toggleMute() {
    setVolumePreferences((current) =>
      current.muted || current.volume === 0
        ? { ...current, volume: current.lastNonZero || 0.7, muted: false }
        : { ...current, lastNonZero: current.volume, muted: true },
    );
  }
  function moveParagraph(delta: number) {
    if (!story) return;
    setError('');
    setPlaying(false);
    setSentenceIndex(0);
    if (delta > 0) advanceParagraph();
    else if (paragraphIndex > 0) setParagraphIndex(paragraphIndex - 1);
    else if (chapterIndex > 0) {
      setChapterIndex(chapterIndex - 1);
      setParagraphIndex(story.chapters[chapterIndex - 1].paragraphs.length - 1);
    }
  }
  function moveSentence(delta: number) {
    if (!story) return;
    setError('');
    setPlaying(false);
    if (delta < 0 && sentenceIndex > 0) setSentenceIndex(sentenceIndex - 1);
    else if (delta > 0 && sentenceIndex < sentences.length - 1) setSentenceIndex(sentenceIndex + 1);
    else moveParagraph(delta);
  }
  function moveChapter(delta: number) {
    if (!story) return;
    const next = Math.min(story.chapters.length - 1, Math.max(0, chapterIndex + delta));
    setChapterIndex(next);
    setParagraphIndex(0);
    setSentenceIndex(0);
    setPlaying(false);
    setDrawer(false);
  }
  async function onFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const loaded = await extractFile(file);
      let resumed = { chapterIndex: 0, paragraphIndex: 0 };
      try {
        const saved = localStorage.getItem(storyKey(loaded));
        if (saved) resumed = JSON.parse(saved) as typeof resumed;
      } catch {
        localStorage.removeItem(storyKey(loaded));
      }
      const fingerprint = documentFingerprint(loaded);
      let stored = loadBookmarks(fingerprint, loaded);
      const legacyKey = `psr-bookmarks-${loaded.sourceName}-${loaded.text.length}`;
      if (!stored.length) {
        try {
          const legacy = localStorage.getItem(legacyKey);
          if (legacy) {
            stored = migrateLegacyBookmarks(JSON.parse(legacy), loaded);
            if (stored.length) {
              saveBookmarks(fingerprint, stored);
              localStorage.removeItem(legacyKey);
            }
          }
        } catch {
          localStorage.removeItem(legacyKey);
        }
      }
      const savedBookmarks: BookmarkEntry[] = stored.flatMap((item) => {
        const ci = loaded.chapters.findIndex((chapter) => chapter.id === item.chapterId);
        const pi =
          ci < 0
            ? -1
            : loaded.chapters[ci].paragraphs.findIndex((paragraph) => paragraph.id === item.paragraphId);
        return ci < 0 || pi < 0 ? [] : [{ ...item, chapterIndex: ci, paragraphIndex: pi }];
      });
      const safeChapter = Math.min(Math.max(0, resumed.chapterIndex || 0), loaded.chapters.length - 1);
      setStory(loaded);
      setChapterIndex(safeChapter);
      const safeParagraph = Math.min(
        Math.max(0, resumed.paragraphIndex || 0),
        loaded.chapters[safeChapter].paragraphs.length - 1,
      );
      setParagraphIndex(safeParagraph);
      setResumePrompt(
        safeChapter > 0 || safeParagraph > 0
          ? {
              fingerprint,
              chapterIndex: safeChapter,
              paragraphIndex: safeParagraph,
              seconds: estimatePositionSeconds(loaded, safeChapter, safeParagraph),
            }
          : null,
      );
      setSentenceIndex(0);
      setPlaying(false);
      setBookmarks(savedBookmarks);
      setDrawer(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We couldn’t open this document.');
    } finally {
      setBusy(false);
    }
  }
  async function openLink() {
    setError('');
    try {
      const url = new URL(link);
      if (
        url.protocol !== 'https:' ||
        !['1drv.ms', 'onedrive.live.com', 'sharepoint.com'].some(
          (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
        )
      )
        throw new Error('Paste an HTTPS OneDrive or SharePoint sharing link.');
      if (url.hostname === 'onedrive.live.com' && url.pathname === '/' && !url.search)
        throw new Error('That is the OneDrive homepage. Open the document, choose “Copy link,” then paste its sharing link here.');
      setBusy(true);
      const response = await apiFetch('/api/documents/shared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.href }),
      });
      if (response.status === 401) {
        window.location.assign(apiUrl('/api/auth/login'));
        return;
      }
      if (!response.ok)
        throw new Error(await responseErrorMessage(response, 'We couldn’t open this shared document.'));
      const name = decodeURIComponent(response.headers.get('X-Document-Name') || 'shared-story.txt');
      await onFile(new File([await response.blob()], name));
    } catch (e) {
      setError(
        e instanceof TypeError
          ? 'The reader API could not be reached. Start the API server and try again.'
          : e instanceof Error
            ? e.message
            : 'Enter a valid document link.',
      );
    } finally {
      setBusy(false);
    }
  }
  function clearStory() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (story) {
      localStorage.removeItem(storyKey(story));
      localStorage.removeItem(bookmarksKey(story));
    }
    setStory(null);
    setResumePrompt(null);
    setPlaying(false);
    setChapterIndex(0);
    setParagraphIndex(0);
    setSentenceIndex(0);
    setBookmarks([]);
    setQuery('');
    setConfirmClear(false);
    setError('');
  }
  function addBookmark() {
    if (!story) return;
    const userLabel = window.prompt('Name this bookmark', story.chapters[chapterIndex].title);
    if (!userLabel?.trim()) return;
    const paragraph = story.chapters[chapterIndex].paragraphs[paragraphIndex];
    const activeOrdinal = allParagraphs.findIndex(
      (item) => item.chapterIndex === chapterIndex && item.paragraphIndex === paragraphIndex,
    );
    const elapsedWords =
      allParagraphs
        .slice(0, activeOrdinal)
        .reduce((sum, item) => sum + item.text.split(/\s+/).filter(Boolean).length, 0) +
      splitSentences(paragraph.text).slice(0, sentenceIndex).join(' ').split(/\s+/).filter(Boolean).length;
    const item: BookmarkEntry = {
      id: crypto.randomUUID(),
      documentFingerprint: documentFingerprint(story),
      chapterId: story.chapters[chapterIndex].id,
      paragraphId: paragraph.id,
      sentenceIndex,
      audioTimeEstimate: Math.round((elapsedWords / 150) * 60),
      userLabel: userLabel.trim(),
      createdAt: Date.now(),
      chapterIndex,
      paragraphIndex,
    };
    setBookmarks((current) => [...current, item]);
  }
  function renameBookmark(item: BookmarkEntry) {
    const userLabel = window.prompt('Rename bookmark', item.userLabel);
    if (userLabel?.trim())
      setBookmarks((current) =>
        current.map((bookmark) =>
          bookmark.id === item.id ? { ...bookmark, userLabel: userLabel.trim() } : bookmark,
        ),
      );
  }
  function deleteBookmark(item: BookmarkEntry) {
    setBookmarks((current) => current.filter((bookmark) => bookmark.id !== item.id));
  }
  function exportBookmarks() {
    if (!story) return;
    const payload = {
      format: 'private-story-reader-bookmarks',
      version: 1,
      documentFingerprint: documentFingerprint(story),
      bookmarks: bookmarks.map(({ chapterIndex: _ci, paragraphIndex: _pi, ...bookmark }) => bookmark),
    };
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    );
    link.href = objectUrl;
    link.download = `${story.sourceName.replace(/\.[^.]+$/, '')}-bookmarks.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  async function importBookmarks(file?: File) {
    if (!story || !file) return;
    try {
      if (file.size > 1_000_000) throw new Error('Bookmark files must be smaller than 1 MB.');
      const payload: unknown = JSON.parse(await file.text());
      if (
        !payload ||
        typeof payload !== 'object' ||
        (payload as { format?: unknown }).format !== 'private-story-reader-bookmarks' ||
        (payload as { version?: unknown }).version !== 1
      )
        throw new Error('This is not a supported bookmark export.');
      const fingerprint = documentFingerprint(story);
      if ((payload as { documentFingerprint?: unknown }).documentFingerprint !== fingerprint)
        throw new Error('These bookmarks belong to a different story.');
      const imported = loadValidBookmarks((payload as { bookmarks?: unknown }).bookmarks, fingerprint, story);
      setBookmarks((current) => [
        ...current,
        ...imported.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import these bookmarks.');
    } finally {
      if (bookmarkImportRef.current) bookmarkImportRef.current.value = '';
    }
  }
  function openPrivacyData() {
    setStoredItems(listStoredItems());
    setStoredExports([]);
    setDownloadedVoices([]);
    setStorageDataError('');
    setClearReport('');
    setPrivacyDataOpen(true);
    void new AudioExportStore()
      .listManifests()
      .then(setStoredExports)
      .catch(() => setStorageDataError('The browser could not list stored audiobook export data.'));
    void Promise.all(
      DOWNLOADABLE_PIPER_VOICES.map(async (voice) => (await isPiperVoiceInstalled(voice.id) ? voice : null)),
    )
      .then((voices) => setDownloadedVoices(voices.filter((voice): voice is PiperVoice => voice !== null)))
      .catch(() => setStorageDataError('The browser could not inspect downloaded voice data.'));
  }
  function removeStoredItem(item: StoredItem) {
    const removed = deleteStoredItem(item.key);
    if (removed && story && item.key === bookmarksKey(story)) {
      skipBookmarkPersist.current = true;
      setBookmarks([]);
    }
    if (removed && item.key === 'psr-volume-preferences') {
      skipVolumePersist.current = true;
      setVolumePreferences({ ...DEFAULT_VOLUME_PREFERENCES });
    }
    if (removed) setStoredItems(listStoredItems());
  }
  async function removeStoredExport(manifest: AudioExportManifest) {
    await cancelRegisteredExport();
    try {
      await new AudioExportStore().deleteJob(manifest.jobId);
      clearRegisteredGeneratedAudio();
      setStoredExports((items) => items.filter((item) => item.jobId !== manifest.jobId));
      setClearReport(`Removed saved audio for “${manifest.metadata.title}”.`);
    } catch {
      setClearReport('Some saved audio could not be removed. Use Clear everything to try again.');
    }
  }
  async function clearCachedAudio() {
    await cancelRegisteredExport();
    try {
      await new AudioExportStore().deleteCachedAudio();
      clearRegisteredGeneratedAudio();
      setStoredExports([]);
      setClearReport(
        'Generated audio and resumable export data were removed. Downloaded voice models remain.',
      );
    } catch {
      setClearReport('Some generated audio could not be removed. Use Clear everything to try again.');
    }
  }
  async function removeDownloadedVoice(voiceId?: PiperVoiceId) {
    const provider = new PiperSpeechProvider();
    try {
      await provider.removeVoice(voiceId);
      setDownloadedVoices((voices) =>
        voiceId ? voices.filter((voice) => voice.id !== voiceId) : [],
      );
      setClearReport(
        voiceId
          ? 'The selected audiobook voice model was removed from this browser.'
          : 'All downloaded audiobook voice models were removed from this browser.',
      );
    } catch {
      setClearReport('The downloaded voice model could not be removed. Use Clear everything to try again.');
    } finally {
      provider.cancelAll();
    }
  }
  async function clearEverything() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    await cancelRegisteredExport();
    const result = await clearBrowserAppData();
    clearRegisteredGeneratedAudio();
    let serverSessionCleared = false;
    try {
      const response = await apiFetch('/api/auth/logout', { method: 'POST' });
      const payload: unknown = await response.json().catch(() => null);
      serverSessionCleared =
        response.ok &&
        Boolean(payload && typeof payload === 'object' && (payload as { ok?: unknown }).ok === true);
    } catch {
      /* API may not be running for a local-only session. */
    }
    skipVolumePersist.current = true;
    setVolumePreferences({ ...DEFAULT_VOLUME_PREFERENCES });
    setStory(null);
    setResumePrompt(null);
    setPlaying(false);
    setChapterIndex(0);
    setParagraphIndex(0);
    setSentenceIndex(0);
    setBookmarks([]);
    setQuery('');
    setStoredItems(listStoredItems());
    setStoredExports([]);
    setDownloadedVoices([]);
    const statuses = [
      result.localStorageCleared
        ? 'local preferences and locators cleared'
        : 'some local preferences could not be removed',
      result.cachesCleared ? 'app caches cleared' : 'some app caches could not be removed',
      result.databasesCleared ? 'app databases cleared' : 'some app databases could not be removed',
      result.opfsCleared
        ? 'downloaded voice and generated audio removed'
        : 'some local voice or generated audio data could not be removed',
      serverSessionCleared ? 'Microsoft session cleared' : 'Microsoft session could not be confirmed cleared',
    ];
    setClearReport(`Clear request finished: ${statuses.join('; ')}.`);
  }
  const changeResult = (ci: number, pi: number) => {
    setChapterIndex(ci);
    setParagraphIndex(pi);
    setSentenceIndex(0);
    setPlaying(false);
    setSearchOpen(false);
  };
  const currentParagraphNumber = Math.max(
    0,
    allParagraphs.findIndex((p) => p.chapterIndex === chapterIndex && p.paragraphIndex === paragraphIndex),
  );
  function seekParagraph(index: number) {
    const item = allParagraphs[index];
    if (item) changeResult(item.chapterIndex, item.paragraphIndex);
  }
  async function checkApiStatus() {
    setApiStatus('Checking reader API…');
    try {
      const response = await apiFetch('/api/health', { signal: AbortSignal.timeout(5000) });
      const data: unknown = await response.json();
      if (!response.ok || !data || typeof data !== 'object' || !('ok' in data) || data.ok !== true)
        throw new Error('The health check returned an error.');
      const version = 'version' in data && typeof data.version === 'string' ? data.version : 'unknown';
      const issues = 'configurationIssues' in data && Array.isArray(data.configurationIssues)
        ? data.configurationIssues.filter((item): item is string => typeof item === 'string')
        : [];
      if (issues.length) {
        setApiStatus(`Reader API is reachable (version ${version}), but Microsoft link reading needs deployment setup: ${issues.join(', ')}.`);
        return;
      }
      setApiStatus(`Reader API is reachable (version ${version}).`);
    } catch {
      setApiStatus('Reader API is unreachable. Check the deployment, API base URL, and allowed origins.');
    }
  }

  return (
    <div className={`app theme-${theme}`}>
      <header className="topbar">
        <a
          className="brand"
          href="#home"
          onClick={(e) => {
            e.preventDefault();
            clearStory();
          }}
          aria-label="Private Story Reader home"
        >
          <span className="brand-mark">
            <AudioLines size={19} />
          </span>
          <span>
            still<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="topbar-center">
          {story ? (
            <>
              <span className="now-reading">NOW READING</span>
              <span className="top-title">{story.title}</span>
            </>
          ) : (
            <span className="privacy-note">
              <span className="privacy-dot" /> PRIVATE BY DESIGN
            </span>
          )}
        </div>
        <div className="top-actions">
          {story && (
            <button
              className="icon-button desktop-only"
              onClick={() => setSearchOpen(true)}
              aria-label="Search story"
            >
              <Search size={18} />
            </button>
          )}
          <button className="support-top-link" onClick={() => setSupportOpen(true)}>
            <Coffee size={14} />
            <span>Support</span>
          </button>
          <button className="icon-button" onClick={() => setSettings(true)} aria-label="Reader settings">
            <Settings2 size={19} />
          </button>
          {story && (
            <button
              className="icon-button mobile-menu"
              onClick={() => setDrawer(true)}
              aria-label="Open chapters"
            >
              <Menu size={20} />
            </button>
          )}
        </div>
      </header>

      {!story ? (
        <main
          id="home"
          className={`landing ${dragActive ? 'landing-dragging' : ''}`}
          onDragOver={(e) => {
            if (hasFileDrag(e.dataTransfer)) {
              e.preventDefault();
              setDragActive(true);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            void onFile(firstDroppedFile(e.dataTransfer));
          }}
        >
          <section className="hero-copy">
            <div className="eyebrow">
              <span className="eyebrow-line" /> YOUR OWN LITTLE LISTENING ROOM
            </div>
            <h1>
              Let the story
              <br />
              find its <em>voice.</em>
            </h1>
            <p className="hero-subtitle">
              A quiet place to turn the words you love into something you can listen to.
            </p>
            <div className="import-card">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void openLink();
                }}
              >
                <label className="field-label" htmlFor="story-link">
                  A link to your story
                </label>
                <div className="link-field">
                  <input
                    id="story-link"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="Paste a OneDrive or SharePoint link"
                  />
                  <button type="submit" disabled={!link.trim() || busy} aria-label="Open story from link">
                    <ChevronRight size={20} />
                  </button>
                </div>
              </form>
              <div className="or-row">
                <span /> <span>OR BRING A FILE</span> <span />
              </div>
              <button
                className={`upload-drop ${dragActive ? 'drag-active' : ''}`}
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                <span className="upload-icon">
                  {busy ? <span className="spinner" /> : <Upload size={18} />}
                </span>
                <span>
                  <strong>
                    {busy
                      ? 'Opening your story…'
                      : dragActive
                        ? 'Drop to open your story'
                        : 'Choose a file to listen to'}
                  </strong>
                  <small>
                    {dragActive
                      ? 'Your file will stay in this browser'
                      : 'Drop it here or browse your device'}
                  </small>
                </span>
                <ChevronRight size={17} className="upload-arrow" />
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept=".txt,.md,.markdown,.pdf,.docx,.epub"
                onChange={(e) => {
                  void onFile(e.target.files?.[0]);
                  e.currentTarget.value = '';
                }}
              />
              <div className="format-row">
                <span>TXT</span>
                <span>MD</span>
                <span>PDF</span>
                <span>DOCX</span>
                <span>EPUB</span>
                <span className="size-note">UP TO 40 MB</span>
              </div>
            </div>
            <p className={`error-message ${error ? 'visible' : ''}`} role="status">
              {error}
              {error && /API|service|reach|unavailable/i.test(error) && (
                <>
                  {' '}
                  <button className="status-check-link" type="button" onClick={() => void checkApiStatus()}>
                    Check status
                  </button>
                </>
              )}
            </p>
            {apiStatus && (
              <p className="api-status" role="status">
                {apiStatus}
              </p>
            )}
            <div className="privacy-foot">
              <span className="lock-dot">⌑</span>
              <span>
                Local files stay in this browser. Shared links use your configured reader API.
                <br />
                <b>Your story is processed for reading and isn't publicly shared.</b>
              </span>
            </div>
          </section>
          <aside className="hero-art" aria-hidden="true">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="book-glow" />
            <div className="book-cover">
              <div className="book-cover-inner">
                <span className="cover-overline">A STORY, HELD CLOSE</span>
                <div className="cover-art">
                  <div className="cover-sun" />
                  <div className="cover-hill hill-back" />
                  <div className="cover-hill hill-front" />
                  <div className="cover-path" />
                </div>
                <span className="cover-title">
                  somewhere
                  <br />
                  <i>between</i>
                  <br />
                  the words
                </span>
                <span className="cover-rule" />
                <span className="cover-author">A MOMENT OF YOUR OWN</span>
              </div>
            </div>
            <span className="floating-note note-top">
              <Sparkles size={14} /> MADE FOR SLOW MOMENTS
            </span>
            <span className="floating-note note-bottom">
              <span className="sound-bars">
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>{' '}
              YOUR VOICE. YOUR PACE.
            </span>
            <div className="art-caption">
              <div className="caption-line" />
              <span>
                MAKE SPACE
                <br />
                FOR A GOOD STORY
              </span>
            </div>
          </aside>
          <footer className="landing-bottom">
            <div className="landing-footer-summary">
              <span className="landing-footer-kicker">LISTEN A LITTLE CLOSER</span>
              <span className="landing-footer-proof">
                <i aria-hidden="true" /> Local first <span aria-hidden="true">·</span> No account needed
              </span>
            </div>
            <button className="support-link" onClick={() => setSupportOpen(true)}>
              Support this project <ChevronRight size={14} aria-hidden="true" />
            </button>
            <nav className="legal-links" aria-label="Policies">
              <button onClick={() => setLegalPage('privacy')}>Privacy</button>
              <button onClick={() => setLegalPage('terms')}>Terms</button>
              <button onClick={() => setLegalPage('copyright')}>Copyright</button>
              <button onClick={() => setLegalPage('storage')}>Storage</button>
              <button onClick={() => setLegalPage('voice')}>Voice data</button>
              <button onClick={() => setLegalPage('donations')}>Donations</button>
            </nav>
            <span className="landing-footer-credit">
              Developed with care by <strong>Navi</strong>
            </span>
          </footer>
        </main>
      ) : (
        <main className="reader-shell">
          <aside className={`sidebar ${drawer ? 'sidebar-open' : ''}`}>
            <div className="sidebar-head">
              <div className="sidebar-kicker">YOUR STORY</div>
              <button
                className="icon-button close-drawer"
                onClick={() => setDrawer(false)}
                aria-label="Close chapters"
              >
                <X size={18} />
              </button>
              <h2 title={story.title}>{story.title}</h2>
              <div className="story-meta">
                <BookOpen size={14} />
                {story.chapters.length} {story.chapters.length === 1 ? 'section' : 'chapters'}
                <span className="meta-dot" />
                {allParagraphs.length} paragraphs
              </div>
            </div>
            <div className="sidebar-label">
              CONTENTS <span>{String(story.chapters.length).padStart(2, '0')}</span>
            </div>
            <nav className="chapter-list" aria-label="Story chapters">
              {story.chapters.map((chapter, i) => (
                <button
                  key={chapter.id}
                  ref={(element) => {
                    chapterLinksRef.current[i] = element;
                  }}
                  className={`chapter-link ${chapterIndex === i ? 'active' : ''}`}
                  onClick={() => moveChapter(i - chapterIndex)}
                >
                  <span className="chapter-number">{String(i + 1).padStart(2, '0')}</span>
                  <span className="chapter-label">{chapter.title}</span>
                  {chapterIndex === i && (
                    <span className="playing-indicator">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </button>
              ))}
            </nav>
            <div className="sidebar-label bookmark-label">
              BOOKMARKS <span>{bookmarks.length}</span>
            </div>
            <div className="bookmark-tools">
              <button onClick={exportBookmarks} disabled={!bookmarks.length}>
                Export
              </button>
              <button onClick={() => bookmarkImportRef.current?.click()}>Import</button>
              <input
                ref={bookmarkImportRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => {
                  void importBookmarks(event.currentTarget.files?.[0]);
                }}
              />
            </div>
            {bookmarks.length > 0 && (
              <div className="bookmark-list">
                {bookmarks.map((b) => (
                  <div key={b.id} className="bookmark-row">
                    <button
                      className="bookmark-jump"
                      onClick={() => {
                        changeResult(b.chapterIndex, b.paragraphIndex);
                        setSentenceIndex(b.sentenceIndex);
                      }}
                      aria-label={`Jump to ${b.userLabel}`}
                    >
                      <Bookmark size={13} />
                      <span>{b.userLabel}</span>
                      <small>
                        {b.chapterIndex + 1}:{b.paragraphIndex + 1}
                      </small>
                    </button>
                    <button
                      className="bookmark-action"
                      onClick={() => renameBookmark(b)}
                      aria-label={`Rename ${b.userLabel}`}
                    >
                      Edit
                    </button>
                    <button
                      className="bookmark-action"
                      onClick={() => deleteBookmark(b)}
                      aria-label={`Delete ${b.userLabel}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="sidebar-bottom">
              <div className="follow-row">
                <span>
                  <span className="follow-icon">
                    <AudioLines size={14} />
                  </span>{' '}
                  Follow narration
                </span>
                <button
                  role="switch"
                  aria-checked={follow}
                  className={`switch ${follow ? 'switch-on' : ''}`}
                  onClick={() => setFollow(!follow)}
                  aria-label="Follow narration"
                >
                  <i />
                </button>
              </div>
              <button className="clear-link" onClick={() => setConfirmClear(true)}>
                <Trash2 size={14} /> Forget this story
              </button>
            </div>
          </aside>
          <section className="reading-pane">
            <p className={`error-message reader-error ${error ? 'visible' : ''}`} role="status">
              {error}
            </p>
            <div className="reader-toolbar">
              <div className="crumb">
                <span>YOUR LIBRARY</span>
                <ChevronRight size={13} />
                <b>{story.title}</b>
              </div>
              <div className="reader-tools">
                <button className="reader-tool" onClick={addBookmark}>
                  <Bookmark size={15} />
                  <span>Bookmark</span>
                </button>
                <button className="reader-tool" onClick={() => setSearchOpen(true)}>
                  <Search size={15} />
                  <span>Find in story</span>
                </button>
              </div>
            </div>
            <article
              className="story-content"
              style={{ '--reading-size': `${fontSize}px` } as React.CSSProperties}
            >
              <div className="chapter-overline">
                <span>CHAPTER {String(chapterIndex + 1).padStart(2, '0')}</span>
                <i />
              </div>
              <h1>{story.chapters[chapterIndex].title}</h1>
              <div className="chapter-rule">
                <span />
              </div>
              <div className="paragraphs">
                {paragraphs.map((p, i) => (
                  <p
                    key={p.id}
                    ref={i === paragraphIndex ? activeRef : null}
                    className={`${i === paragraphIndex ? 'paragraph-current' : ''} ${playing && i === paragraphIndex ? 'sentence-active' : ''}`}
                  >
                    {splitSentences(p.text).map((sentence, j) => (
                      <span
                        key={`${p.id}-s${j}`}
                        className={i === paragraphIndex && j === sentenceIndex ? 'spoken-sentence' : ''}
                      >
                        {sentence}
                        {j < splitSentences(p.text).length - 1 ? ' ' : ''}
                      </span>
                    ))}
                  </p>
                ))}
              </div>
              <div className="chapter-end">
                <span />{' '}
                <span>END OF {chapterIndex === story.chapters.length - 1 ? 'STORY' : 'CHAPTER'}</span>{' '}
                <span />
              </div>
              <div className="chapter-navigation">
                <button onClick={() => moveChapter(-1)} disabled={chapterIndex === 0}>
                  <ChevronLeft size={15} /> Previous chapter
                </button>
                <span>
                  {chapterIndex + 1} / {story.chapters.length}
                </span>
                <button onClick={() => moveChapter(1)} disabled={chapterIndex === story.chapters.length - 1}>
                  Next chapter <ChevronRight size={15} />
                </button>
              </div>
            </article>
          </section>
        </main>
      )}

      {story && (
        <footer className="player">
          <div className="player-book">
            <div className="mini-cover">
              <BookOpen size={16} />
            </div>
            <div className="player-book-copy">
              <strong>{story.title}</strong>
              <span>{story.chapters[chapterIndex].title}</span>
            </div>
          </div>
          <div className="player-center">
            <div className="transport">
              <button
                className="seek-button"
                title="Previous sentence (Left Arrow)"
                onClick={() => moveSentence(-1)}
                aria-label="Previous sentence"
              >
                <ChevronLeft size={19} />
                <span>sentence</span>
              </button>
              <button className="play-button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
              </button>
              <button
                className="seek-button"
                title="Next sentence (Right Arrow)"
                onClick={() => moveSentence(1)}
                aria-label="Next sentence"
              >
                <ChevronRight size={19} />
                <span>sentence</span>
              </button>
              <button
                className="more-skips-trigger"
                onClick={() => setMoreSkips((value) => !value)}
                aria-expanded={moreSkips}
                aria-label="More skip options"
                title="More skip options"
              >
                <MoreHorizontal size={19} />
                <span>More</span>
              </button>
            </div>
            {moreSkips && (
              <div className="more-skips-menu" role="group" aria-label="Paragraph and chapter navigation">
                <strong>More skip options</strong>
                <div>
                  <span>Paragraph</span>
                  <button
                    title="Previous paragraph (Ctrl + Left)"
                    aria-label="Previous paragraph"
                    onClick={() => moveParagraph(-1)}
                  >
                    <SkipBack size={15} />
                  </button>
                  <button
                    title="Next paragraph (Ctrl + Right)"
                    aria-label="Next paragraph"
                    onClick={() => moveParagraph(1)}
                  >
                    <SkipForward size={15} />
                  </button>
                </div>
                <div>
                  <span>Chapter</span>
                  <button
                    title="Previous chapter (Shift + Left)"
                    aria-label="Previous chapter"
                    onClick={() => moveChapter(-1)}
                    disabled={chapterIndex === 0}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    title="Next chapter (Shift + Right)"
                    aria-label="Next chapter"
                    onClick={() => moveChapter(1)}
                    disabled={chapterIndex === story.chapters.length - 1}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                <small>Sentence: ← / → · Paragraph: Ctrl + ← / → · Chapter: Shift + ← / →</small>
              </div>
            )}
            <div className="progress-row">
              <span aria-hidden="true">
                {String(chapterIndex + 1).padStart(2, '0')}·{String(paragraphIndex + 1).padStart(2, '0')}
              </span>
              <input
                className="progress-slider"
                type="range"
                min={0}
                max={Math.max(allParagraphs.length - 1, 0)}
                value={currentParagraphNumber}
                style={
                  {
                    '--range-progress': `${Math.round((currentParagraphNumber / Math.max(allParagraphs.length - 1, 1)) * 100)}%`,
                  } as React.CSSProperties
                }
                onChange={(e) => seekParagraph(Number(e.target.value))}
                aria-label="Jump to a paragraph"
                disabled={allParagraphs.length < 2}
              />
              <span>{allParagraphs.length} paragraphs</span>
            </div>
          </div>
          <div className="player-settings">
            <label className="speed-select">
              <span>PACE</span>
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                aria-label="Speaking speed"
              >
                {speeds.map((s) => (
                  <option key={s} value={s}>
                    {s.toFixed(s % 1 ? 2 : 1)}×
                  </option>
                ))}
              </select>
              <ChevronDown size={12} />
            </label>
            <VolumeControl
              volume={volumePreferences.volume}
              muted={volumePreferences.muted}
              onVolumeChange={setVolume}
              onToggleMute={toggleMute}
            />
            <div className="voice-note">
              <span>Browser voice</span>
            </div>
          </div>
        </footer>
      )}

      {settings && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSettings(false);
          }}
        >
          <section
            className="settings-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div className="dialog-head">
              <div>
                <span className="dialog-kicker">MAKE IT YOURS</span>
                <h2 id="settings-title">Reading settings</h2>
              </div>
              <button className="icon-button" onClick={() => setSettings(false)} aria-label="Close settings">
                <X size={19} />
              </button>
            </div>
            <div className="setting-section">
              <h3>Appearance</h3>
              <div className="setting-row">
                <div>
                  <strong>Reading theme</strong>
                  <small>Choose a comfortable page color</small>
                </div>
                <div className="theme-options">
                  {(['light', 'sepia', 'dark', 'high-contrast'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className={theme === t ? 'theme-choice chosen' : 'theme-choice'}
                      aria-pressed={theme === t}
                    >
                      {t === 'light' ? (
                        <Sun size={14} />
                      ) : t === 'dark' ? (
                        <Moon size={14} />
                      ) : t === 'high-contrast' ? (
                        <Contrast size={14} />
                      ) : (
                        <span className="sepia-dot" />
                      )}
                      {t === 'high-contrast' ? 'High contrast' : t[0].toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Text size</strong>
                  <small>Adjust the reading type</small>
                </div>
                <div className="font-controls">
                  <button
                    onClick={() => setFontSize(Math.max(16, fontSize - 1))}
                    aria-label="Decrease text size"
                  >
                    A−
                  </button>
                  <span>{fontSize}px</span>
                  <button
                    onClick={() => setFontSize(Math.min(25, fontSize + 1))}
                    aria-label="Increase text size"
                  >
                    A+
                  </button>
                </div>
              </div>
            </div>
            <div className="setting-section">
              <h3>Listening</h3>
              <div className="setting-row">
                <div>
                  <strong>Speaking pace</strong>
                  <small>Change narration speed</small>
                </div>
                <select
                  className="setting-select"
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                >
                  {speeds.map((s) => (
                    <option key={s} value={s}>
                      {s.toFixed(s % 1 ? 2 : 1)}×
                    </option>
                  ))}
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Volume</strong>
                  <small>App playback level · {Math.round(volumePreferences.volume * 100)}%</small>
                </div>
                <VolumeControl
                  volume={volumePreferences.volume}
                  muted={volumePreferences.muted}
                  onVolumeChange={setVolume}
                  onToggleMute={toggleMute}
                />
              </div>
              <div className="setting-row">
                <div>
                  <strong>Follow narration</strong>
                  <small>Keep the current paragraph in view</small>
                </div>
                <button
                  role="switch"
                  aria-checked={follow}
                  className={`switch ${follow ? 'switch-on' : ''}`}
                  onClick={() => setFollow(!follow)}
                >
                  <i />
                </button>
              </div>
            </div>
            <div className="privacy-card">
              <span>
                <CircleHelp size={17} />
              </span>
              <p>
                <strong>Your story is processed for reading and isn't publicly shared.</strong>
                <br />
                Shared links use your configured API. Browser voices cannot be exported; Piper audiobook audio
                stays in local browser storage until you remove it.
              </p>
            </div>
            <button className="secondary-button privacy-view-button" onClick={openPrivacyData}>
              Review saved data
            </button>
            <nav className="settings-policy-links" aria-label="Policies">
              <button onClick={() => setLegalPage('privacy')}>Privacy policy</button>
              <button onClick={() => setLegalPage('storage')}>Local storage</button>
              <button onClick={() => setLegalPage('voice')}>Voice data</button>
              <button onClick={() => setLegalPage('donations')}>Donations</button>
            </nav>
            <div className="dialog-footer">
              <button
                className="secondary-button"
                onClick={() => {
                  setSettings(false);
                  setConfirmClear(true);
                }}
              >
                <Trash2 size={14} /> Forget story
              </button>
              <button className="primary-button" onClick={() => setSettings(false)}>
                Done <Check size={15} />
              </button>
            </div>
          </section>
        </div>
      )}
      {searchOpen && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSearchOpen(false);
          }}
        >
          <section className="search-panel" role="dialog" aria-modal="true" aria-labelledby="search-title">
            <div className="search-head">
              <div className="search-box">
                <Search size={19} />
                <input
                  ref={inputRef}
                  id="search-title"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a word or phrase…"
                />
                <kbd>ESC</kbd>
              </div>
              <button className="icon-button" onClick={() => setSearchOpen(false)} aria-label="Close search">
                <X size={19} />
              </button>
            </div>
            <div className="search-results">
              {!query.trim() ? (
                <div className="search-empty">
                  <Search size={20} />
                  <span>Search through this story</span>
                  <small>Your search stays on this device.</small>
                </div>
              ) : results.length ? (
                results.map((result) => (
                  <button
                    className="search-result"
                    key={result.id}
                    onClick={() => changeResult(result.chapterIndex, result.paragraphIndex)}
                  >
                    <span>{result.chapterTitle}</span>
                    <p>
                      {result.text.slice(0, 190)}
                      {result.text.length > 190 ? '…' : ''}
                    </p>
                    <ChevronRight size={15} />
                  </button>
                ))
              ) : (
                <div className="search-empty">
                  <span>No passages found</span>
                  <small>Try another word or phrase.</small>
                </div>
              )}
            </div>
            <div className="search-foot">
              {query
                ? `${results.length} ${results.length === 1 ? 'passage' : 'passages'}${results.length === 30 ? ' (showing first 30)' : ''}`
                : 'Press Ctrl K any time to search'}
            </div>
          </section>
        </div>
      )}
      {confirmClear && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmClear(false);
          }}
        >
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-title"
          >
            <div className="confirm-icon">
              <Trash2 size={20} />
            </div>
            <h2 id="clear-title">Forget this story?</h2>
            <p>
              The story text, playback position and bookmarks will be cleared from this browser. This can’t be
              undone.
            </p>
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setConfirmClear(false)}>
                Keep reading
              </button>
              <button className="danger-button" onClick={clearStory}>
                Forget story
              </button>
            </div>
          </section>
        </div>
      )}
      {resumePrompt && story && (
        <div className="overlay">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="resume-title">
            <div className="confirm-icon">
              <BookOpen size={20} />
            </div>
            <h2 id="resume-title">Continue where you left off?</h2>
            <p>
              Chapter {resumePrompt.chapterIndex + 1}, paragraph {resumePrompt.paragraphIndex + 1} · about{' '}
              {formatEstimate(resumePrompt.seconds)} into this story.
            </p>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  localStorage.removeItem(storyKey(story));
                  setChapterIndex(0);
                  setParagraphIndex(0);
                  setSentenceIndex(0);
                  setResumePrompt(null);
                }}
              >
                Start over
              </button>
              <button className="primary-button" onClick={() => setResumePrompt(null)}>
                Continue
              </button>
            </div>
          </section>
        </div>
      )}
      {privacyDataOpen && (
        <div
          className="overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPrivacyDataOpen(false);
          }}
        >
          <section
            className="privacy-data-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="privacy-data-title"
          >
            <div className="dialog-head">
              <div>
                <span className="dialog-kicker">YOUR DEVICE</span>
                <h2 id="privacy-data-title">Stored reader data</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setPrivacyDataOpen(false)}
                aria-label="Close stored data"
              >
                <X size={18} />
              </button>
            </div>
            <p className="privacy-data-intro">
              Your story is processed on this device for reading and audiobook export. The reader stores
              preferences, locators, and resumable audio only in browser storage.
            </p>
            {storedItems.length ? (
              <ul className="stored-items">
                {storedItems.map((item) => (
                  <li key={item.key}>
                    <span>
                      <strong>{item.purpose}</strong>
                      <small>{item.key}</small>
                    </span>
                    <button
                      className="bookmark-action"
                      onClick={() => removeStoredItem(item)}
                      aria-label={`Delete ${item.purpose}`}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="stored-empty">No reader data is stored in localStorage.</p>
            )}
            <h3>Generated audio and resumable exports</h3>
            <p className="privacy-data-intro">
              Audio chunks and export manifests are stored in this origin’s private file system so an
              interrupted export can resume. They do not contain story text. Remove an export to delete its
              generated audio; shared cached chunks remain only when another export uses them.
            </p>
            {storedExports.length ? (
              <ul className="stored-items">
                {storedExports.map((manifest) => (
                  <li key={manifest.jobId}>
                    <span>
                      <strong>{manifest.metadata.title}</strong>
                      <small>
                        Audiobook export · {manifest.state} · updated{' '}
                        {new Date(manifest.updatedAt).toLocaleString()}
                      </small>
                    </span>
                    <button
                      className="bookmark-action"
                      onClick={() => void removeStoredExport(manifest)}
                      aria-label={`Delete generated audio for ${manifest.metadata.title}`}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="stored-empty">No generated audio or resumable exports are listed.</p>
            )}
            {downloadedVoices.length > 0 && (
              <ul className="stored-items">
                {downloadedVoices.map((voice) => (
                  <li key={voice.id}>
                    <span>
                      <strong>{voice.name} voice model</strong>
                      <small>
                        About {Math.ceil(voice.modelBytes / 1_000_000)} MB · stored locally for audiobook
                        generation
                      </small>
                    </span>
                    <button
                      className="bookmark-action"
                      onClick={() => void removeDownloadedVoice(voice.id)}
                      aria-label={`Remove downloaded ${voice.name} voice model`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {storageDataError && (
              <p className="clear-report" role="status">
                {storageDataError}
              </p>
            )}
            {clearReport && (
              <p className="clear-report" role="status">
                {clearReport}
              </p>
            )}
            <div className="dialog-footer">
              <button className="secondary-button" onClick={() => void clearCachedAudio()}>
                Clear cached audio
              </button>
              <button className="danger-button" onClick={() => void clearEverything()}>
                Clear everything
              </button>
              <button className="primary-button" onClick={() => setPrivacyDataOpen(false)}>
                Done
              </button>
            </div>
          </section>
        </div>
      )}
      {story && (
        <AudiobookExportDialog
          key={story.id}
          story={story}
          currentChapterIndex={chapterIndex}
          speed={speed}
          volume={volumePreferences}
        />
      )}
      {legalPage && <LegalDialog page={legalPage} onClose={() => setLegalPage(null)} />}
      {supportOpen && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSupportOpen(false);
          }}
        >
          <section className="support-dialog" role="dialog" aria-modal="true" aria-labelledby="support-title">
            <div className="dialog-head">
              <span className="support-icon">
                <Coffee size={20} />
              </span>
              <button
                className="icon-button"
                onClick={() => setSupportOpen(false)}
                aria-label="Close support"
              >
                <X size={18} />
              </button>
            </div>
            <span className="dialog-kicker">OPTIONAL, ALWAYS FREE TO READ</span>
            <h2 id="support-title">Help this little project grow.</h2>
            <p>
              Private Story Reader is a free, independent, open-source project supported by voluntary
              donations. Gifts help cover hosting and domain costs, and never unlock features.
            </p>
            {donationLinks.length ? (
              <div className="donation-options">
                {donationLinks.map((item) => (
                  <a
                    key={item.provider}
                    className="primary-button support-continue"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.label} <ChevronRight size={15} />
                  </a>
                ))}
              </div>
            ) : (
              <div className="support-unconfigured">
                <strong>Support links are not configured</strong>
                <span>
                  Maintainers can add approved donation destinations in the app environment configuration.
                </span>
              </div>
            )}
            <small className="support-privacy">
              Payments are handled by the linked provider. This app never receives card or bank details.
            </small>
          </section>
        </div>
      )}
    </div>
  );
}
