import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VolumeControl } from './VolumeControl';

describe('VolumeControl', () => {
  it('supports keyboard adjustment and mute restore through callbacks', () => {
    const onVolumeChange = vi.fn();
    const onToggleMute = vi.fn();
    const first = render(<VolumeControl volume={0.7} muted={false} onVolumeChange={onVolumeChange} onToggleMute={onToggleMute}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Volume control' }));
    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(slider.getAttribute('aria-valuenow')).toBe('70');
    expect(slider.getAttribute('aria-valuetext')).toBe('70 percent');
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(onVolumeChange).toHaveBeenCalledWith(0.75);
    fireEvent.keyDown(slider, { key: 'ArrowDown', shiftKey: true });
    expect(onVolumeChange).toHaveBeenLastCalledWith(0.6);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onVolumeChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(onToggleMute).toHaveBeenCalledOnce();
    first.unmount();
  });

  it('exposes percentage and unmute state', () => {
    const onVolumeChange = vi.fn();
    render(<VolumeControl volume={0} muted onVolumeChange={onVolumeChange} onToggleMute={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Volume control' }));
    expect(screen.getByRole('button', { name: 'Unmute' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('0%')).toBeTruthy();
  });
});
