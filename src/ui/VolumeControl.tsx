import { useEffect, useRef, useState } from 'react';
import { Volume, Volume1, Volume2, VolumeX } from 'lucide-react';

type Props = { volume: number; muted: boolean; onVolumeChange: (value: number) => void; onToggleMute: () => void; label?: string };

export function VolumeControl({ volume, muted, onVolumeChange, onToggleMute, label = 'Volume' }: Props) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const percent = Math.round(volume * 100);
  const Icon = muted || percent === 0 ? VolumeX : percent < 34 ? Volume : percent < 67 ? Volume1 : Volume2;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [open]);

  function setFromPointer(clientX: number) {
    const rect = sliderRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    onVolumeChange(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
  }
  function onSliderKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    let next: number | undefined;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = volume + (event.shiftKey ? 0.1 : 0.05);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = volume - (event.shiftKey ? 0.1 : 0.05);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 1;
    else if (event.key.toLowerCase() === 'm') { event.preventDefault(); event.stopPropagation(); onToggleMute(); return; }
    if (next !== undefined) { event.preventDefault(); onVolumeChange(Math.min(1, Math.max(0, next))); }
  }

  return <div ref={rootRef} className={`volume-control${open ? ' volume-open' : ''}`}>
    <button type="button" className="volume-trigger" onClick={() => setOpen(value => !value)} aria-label={`${label} control`} aria-expanded={open}><Icon size={17}/></button>
    {open && <div className="volume-popover" role="group" aria-label={`${label} controls`}>
      <button type="button" className="volume-mute" onClick={onToggleMute} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted}><Icon size={17}/></button>
      <div className="volume-slider-wrap">
        <div ref={sliderRef} className="volume-slider" role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent} percent`} onKeyDown={onSliderKeyDown} onWheel={event => { event.preventDefault(); onVolumeChange(Math.min(1, Math.max(0, volume + (event.deltaY < 0 ? 0.05 : -0.05)))); }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); setFromPointer(event.clientX); }} onPointerMove={event => { if (dragging) setFromPointer(event.clientX); }} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}>
          <span className="volume-track"><i style={{ width: `${percent}%` }}/></span><span className="volume-thumb" style={{ left: `${percent}%` }}/>
        </div>
        <span className="volume-percent" aria-live="polite">{percent}%</span>
        {dragging && <span className="volume-tooltip" style={{ left: `${percent}%` }} role="status">{percent}%</span>}
      </div>
    </div>}
  </div>;
}
