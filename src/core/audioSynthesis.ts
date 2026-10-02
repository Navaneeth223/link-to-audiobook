import { splitSentences } from './document';
import { sanitizeSpeechInput } from './piper';
import type { PcmAudio, SampleSpeechProvider } from './speech';

const SKIPPED_SENTENCE_SILENCE_MS = 350;
const SENTENCE_GAP_MS = 80;

export type ResilientSynthesisResult = {
  audio: PcmAudio;
  skippedSentenceIndexes: number[];
};

function isFatalSynthesisError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : '';
  return /(?:out of memory|memory allocation|voice-download-failed|not-enough-space|worker crash)/iu.test(
    message,
  );
}

function silence(sampleRate: number, durationMs: number): Float32Array {
  return new Float32Array(Math.max(1, Math.round((sampleRate * durationMs) / 1_000)));
}

function concatenatePcm(parts: Float32Array[]): Float32Array {
  const result = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export async function synthesizeWithRecovery(
  provider: Pick<SampleSpeechProvider, 'synthesize'>,
  text: string,
  sampleRate: number,
  firstSentenceIndex = 0,
): Promise<ResilientSynthesisResult> {
  const sanitized = sanitizeSpeechInput(text);
  if (!sanitized) {
    return {
      audio: { samples: silence(sampleRate, SKIPPED_SENTENCE_SILENCE_MS), sampleRate, channels: 1 },
      skippedSentenceIndexes: [firstSentenceIndex],
    };
  }

  try {
    return { audio: await provider.synthesize(sanitized), skippedSentenceIndexes: [] };
  } catch (error) {
    if (isFatalSynthesisError(error)) throw error;
  }

  const sentences = splitSentences(sanitized);
  if (!sentences.length) {
    return {
      audio: { samples: silence(sampleRate, SKIPPED_SENTENCE_SILENCE_MS), sampleRate, channels: 1 },
      skippedSentenceIndexes: [firstSentenceIndex],
    };
  }

  const parts: Float32Array[] = [];
  const skippedSentenceIndexes: number[] = [];
  for (const [index, sentence] of sentences.entries()) {
    try {
      const audio = await provider.synthesize(sanitizeSpeechInput(sentence));
      if (audio.sampleRate !== sampleRate || audio.channels !== 1) {
        throw new Error('The voice engine returned inconsistent audio settings.');
      }
      if (parts.length) parts.push(silence(sampleRate, SENTENCE_GAP_MS));
      parts.push(audio.samples);
    } catch (error) {
      if (isFatalSynthesisError(error)) throw error;
      skippedSentenceIndexes.push(firstSentenceIndex + index);
      if (parts.length) parts.push(silence(sampleRate, SENTENCE_GAP_MS));
      parts.push(silence(sampleRate, SKIPPED_SENTENCE_SILENCE_MS));
    }
  }

  return {
    audio: { samples: concatenatePcm(parts), sampleRate, channels: 1 },
    skippedSentenceIndexes,
  };
}
