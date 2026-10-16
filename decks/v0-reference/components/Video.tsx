import { useEffect, useRef, useState } from 'react';
import type { ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';
import { mediaFrame, mediaFit, mediaMeta } from './media.js';

export const slidewright = mediaMeta('Video');
export const canvas = makeRectAdapter({ width: 640, height: 360 });

export default function Video({ slots, params }: ComponentRenderProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const src = typeof slots.src === 'string' ? slots.src : '';
  const label = String(params.label ?? 'Video');
  useEffect(() => {
    setPlaying(false);
    setError('');
  }, [src]);
  async function play() {
    try {
      await ref.current?.play();
      setError('');
    } catch {
      setError('Unable to play video');
    }
  }
  return (
    <div style={{ ...mediaFrame(params), background: '#111', color: '#fff' }}>
      {src ? (
        <>
          <video key={src} ref={ref} src={src} aria-label={label} playsInline preload="metadata"
            loop={Boolean(params.loop ?? true)} muted={Boolean(params.muted ?? true)}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
            onError={() => setError('Unable to load video')}
            style={{ width: '100%', height: '100%', objectFit: mediaFit(params.fit), pointerEvents: 'none' }} />
          <div data-sw-presentation-interactive onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}
            style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', gap: 8, fontSize: 24 }}>
            <button type="button" aria-label={`${playing ? 'Pause' : 'Play'} ${label}`}
              onClick={() => playing ? ref.current?.pause() : void play()}>{playing ? 'Pause' : 'Play'}</button>
            <button type="button" aria-label={`Restart ${label}`} onClick={() => {
              if (ref.current) ref.current.currentTime = 0;
              void play();
            }}>Restart</button>
          </div>
          {error && <div role="status" style={{ position: 'absolute', top: 8, left: 8 }}>{error}</div>}
        </>
      ) : <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>Set video source</div>}
    </div>
  );
}
