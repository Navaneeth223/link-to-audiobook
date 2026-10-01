import { describe, expect, it } from 'vitest';
import { normalizeText, segmentStory, splitSentences } from './document';
describe('document normalization', () => {
  it('normalizes line endings and excessive whitespace', () => expect(normalizeText(' a\r\nb\n\n\n c ')).toBe('a\nb\n\nc'));
  it('detects chapters and preserves paragraph wording', () => { const story = segmentStory('CHAPTER ONE\n\nRain fell.\n\nCHAPTER TWO: Dawn\n\nThe sky cleared.', 'Book', 'book.txt'); expect(story.chapters).toHaveLength(2); expect(story.chapters[0].paragraphs[0].text).toBe('Rain fell.'); expect(story.chapters[1].title).toBe('CHAPTER TWO: Dawn'); });
  it('splits sentence playback without changing source words', () => expect(splitSentences('“Wait here,” she said. Then she ran!')).toEqual(['“Wait here,” she said.', 'Then she ran!']));
});
