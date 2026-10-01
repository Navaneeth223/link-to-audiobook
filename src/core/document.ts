import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export type Paragraph = { id: string; text: string };
export type Chapter = { id: string; title: string; paragraphs: Paragraph[] };
export type Story = { id: string; title: string; sourceName: string; chapters: Chapter[]; text: string; createdAt: number };
const heading = /^(chapter\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[a-z]+)(?:\s*[:.\-–—].*)?|part\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|[a-z]+)(?:\s*[:.\-–—].*)?|(?:\d+|[ivxlcdm]+)[.)]?\s+[\p{Lu}][^.!?]{1,90})$/iu;
export function normalizeText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/^[\t ]+|[\t ]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
export function splitSentences(text: string): string[] {
  return text.match(/[^.!?…]+(?:[.!?…]+[”’'"”)]*)?|[.!?…]+/g)?.map(sentence => sentence.trim()).filter(Boolean) ?? (text.trim() ? [text.trim()] : []);
}
function checkArchiveLimits(zip: { files: Record<string, { dir: boolean; _data?: { uncompressedSize?: number } }> }): void {
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  const expandedBytes = entries.reduce((sum, entry) => sum + (entry._data?.uncompressedSize ?? 0), 0);
  if (entries.length > 5000 || expandedBytes > 200 * 1024 * 1024 || entries.some(entry => (entry._data?.uncompressedSize ?? 0) > 40 * 1024 * 1024)) throw new Error('This compressed document expands beyond the safe reading limit.');
}
export function segmentStory(raw: string, title: string, sourceName: string): Story {
  const lines = normalizeText(raw).split('\n');
  const chapters: Chapter[] = [];
  let current: Chapter = { id: 'chapter-1', title: 'The beginning', paragraphs: [] };
  let buffer: string[] = [];
  const flush = () => { const text = buffer.join(' ').replace(/\s+/g, ' ').trim(); if (text) current.paragraphs.push({ id: `p-${chapters.length + 1}-${current.paragraphs.length + 1}`, text }); buffer = []; };
  for (const line of lines) {
    const clean = line.trim();
    if (!clean) { flush(); continue; }
    const markdownHeading = /^#{1,6}\s+\S/.test(clean);
    if (heading.test(clean) || markdownHeading) { flush(); if (current.paragraphs.length || chapters.length) chapters.push(current); current = { id: `chapter-${chapters.length + 1}`, title: markdownHeading ? clean.replace(/^#{1,6}\s+/, '') : clean, paragraphs: [] }; continue; }
    buffer.push(clean);
  }
  flush(); if (current.paragraphs.length) chapters.push(current);
  if (!chapters.length) throw new Error('We couldn’t extract readable text from this document.');
  if (chapters[0].title === 'The beginning') chapters[0].title = title || 'The beginning';
  const text = chapters.flatMap(c => c.paragraphs.map(p => p.text)).join('\n\n');
  return { id: `${sourceName}-${Date.now()}`, title: title || sourceName.replace(/\.[^.]+$/, ''), sourceName, chapters, text, createdAt: Date.now() };
}
export async function extractFile(file: File): Promise<Story> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (file.size > 40 * 1024 * 1024) throw new Error('This file is larger than the 40 MB limit.');
  let text = '';
  if (['txt', 'md', 'markdown'].includes(ext ?? '')) text = await file.text();
  else if (ext === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    if (doc.numPages > 2000) throw new Error('This PDF contains too many pages to open safely.');
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) { const page = await doc.getPage(i); const content = await page.getTextContent(); pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' ')); }
    text = pages.join('\n\n');
    if (text.length > 10_000_000) throw new Error('This PDF contains too much extracted text to open safely.');
    if (!normalizeText(text)) throw new Error('This PDF appears to contain scanned pages. OCR is required to read it.');
  } else if (ext === 'docx') {
    const { default: JSZip } = await import('jszip');
    const docxZip = await JSZip.loadAsync(await file.arrayBuffer()); checkArchiveLimits(docxZip);
    const { default: mammoth } = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() }); text = result.value;
  } else if (ext === 'epub') {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    checkArchiveLimits(zip);
    const container = zip.file('META-INF/container.xml'); if (!container) throw new Error('This EPUB file is missing its book index.');
    const xml = new DOMParser().parseFromString(await container.async('text'), 'application/xml');
    const opfPath = xml.querySelector('rootfile')?.getAttribute('full-path'); if (!opfPath) throw new Error('This EPUB file is missing its book index.');
    const opf = zip.file(opfPath); if (!opf) throw new Error('This EPUB file is incomplete.');
    const opfXml = new DOMParser().parseFromString(await opf.async('text'), 'application/xml');
    const manifest = new Map(Array.from(opfXml.querySelectorAll('manifest item')).map(item => [item.getAttribute('id') ?? '', item.getAttribute('href') ?? '']));
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const docs: string[] = [];
    for (const item of Array.from(opfXml.querySelectorAll('spine itemref'))) { const href = manifest.get(item.getAttribute('idref') ?? ''); if (!href) continue; const entry = zip.file(base + decodeURIComponent(href)); if (!entry) continue; const html = new DOMParser().parseFromString(await entry.async('text'), 'text/html'); docs.push(html.body.textContent ?? ''); }
    text = docs.join('\n\n');
  } else throw new Error('Choose a TXT, Markdown, PDF, DOCX, or EPUB file.');
  return segmentStory(text, file.name.replace(/\.[^.]+$/, ''), file.name);
}
