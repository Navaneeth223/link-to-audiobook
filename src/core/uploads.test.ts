import { describe, expect, it } from 'vitest';
import { firstDroppedFile, hasFileDrag } from './uploads';

describe('file drag and drop helpers', () => {
  it('uses DataTransfer.files and falls back to file items', () => {
    const file = new File(['data'], 'story.txt', { type: 'text/plain' });
    expect(firstDroppedFile({ files: [file], items: [] } as unknown as DataTransfer)).toBe(file);
    const item = { kind: 'file', getAsFile: () => file };
    expect(firstDroppedFile({ files: [], items: [item] } as unknown as DataTransfer)).toBe(file);
    expect(hasFileDrag({ types: ['Files'], items: [] } as unknown as DataTransfer)).toBe(true);
    expect(firstDroppedFile({ files: [], items: [] } as unknown as DataTransfer)).toBeUndefined();
  });
});
