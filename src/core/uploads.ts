export function firstDroppedFile(dataTransfer: DataTransfer): File | undefined {
  const files = Array.from(dataTransfer.files ?? []);
  if (files.length) return files[0];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return undefined;
}

export function hasFileDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).includes('Files') || Array.from(dataTransfer.items ?? []).some(item => item.kind === 'file');
}
