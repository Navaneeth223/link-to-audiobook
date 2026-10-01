import { useMemo } from 'react';
import { X } from 'lucide-react';
import privacy from '../../docs/PRIVACY.md?raw';
import terms from '../../docs/TERMS.md?raw';
import copyright from '../../docs/COPYRIGHT-AND-TAKEDOWN.md?raw';
import storage from '../../docs/LOCAL-STORAGE.md?raw';
import voice from '../../docs/VOICE-DATA.md?raw';
import donations from '../../docs/DONATIONS.md?raw';

export type LegalPage = 'privacy' | 'terms' | 'copyright' | 'storage' | 'voice' | 'donations';
const pages: Record<LegalPage, { title: string; body: string }> = {
  privacy: { title: 'Privacy policy', body: privacy }, terms: { title: 'Terms of use', body: terms },
  copyright: { title: 'Copyright and takedown', body: copyright }, storage: { title: 'Local storage and cookies', body: storage },
  voice: { title: 'Voice data policy', body: voice }, donations: { title: 'Donation disclosure', body: donations },
};

function MarkdownBody({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.split(/\r?\n/); const output: Array<{ type: 'heading' | 'paragraph' | 'list' | 'table'; level?: number; lines: string[] }> = [];
    for (let i = 0; i < lines.length;) {
      const line = lines[i].trim();
      if (!line) { i++; continue; }
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      if (heading) { output.push({ type: 'heading', level: heading[1].length, lines: [heading[2]] }); i++; continue; }
      if (line.startsWith('|')) { const rows: string[] = []; while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++].trim()); output.push({ type: 'table', lines: rows.filter(row => !/^\|[\s:|-]+\|$/.test(row)) }); continue; }
      if (/^[-*]\s+/.test(line)) { const items: string[] = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, '')); output.push({ type: 'list', lines: items }); continue; }
      const paragraph = [line]; i++; while (i < lines.length && lines[i].trim() && !/^(#{1,3})\s+|^[-*]\s+|^\|/.test(lines[i].trim())) paragraph.push(lines[i++].trim()); output.push({ type: 'paragraph', lines: paragraph });
    }
    return output;
  }, [text]);
  return <div className="legal-markdown">{blocks.map((block, index) => block.type === 'heading'
    ? block.level === 1 ? null : <h3 key={index}>{block.lines[0]}</h3>
    : block.type === 'list' ? <ul key={index}>{block.lines.map((line, i) => <li key={i}>{line.replace(/`/g, '')}</li>)}</ul>
      : block.type === 'table' ? <div className="legal-table" key={index}>{block.lines.map((row, i) => <div key={i}>{row.split('|').filter(Boolean).map((cell, j) => <span key={j}>{cell.trim()}</span>)}</div>)}</div>
        : <p key={index}>{block.lines.join(' ').replace(/\*\*/g, '').replace(/`/g, '')}</p>)}</div>;
}

export function LegalDialog({ page, onClose }: { page: LegalPage; onClose: () => void }) {
  const content = pages[page];
  return <div className="overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="legal-dialog" role="dialog" aria-modal="true" aria-labelledby="legal-title"><div className="dialog-head"><h2 id="legal-title">{content.title}</h2><button className="icon-button" onClick={onClose} aria-label="Close policy"><X size={19}/></button></div><MarkdownBody text={content.body}/><div className="dialog-footer"><span>Project policy template · review before public launch</span><button className="primary-button" onClick={onClose}>Done</button></div></section></div>;
}
