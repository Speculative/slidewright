import type { ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';
import { mediaFrame, mediaFit, mediaMeta } from './media.js';

export const slidewright = mediaMeta('Image');
export const canvas = makeRectAdapter({ width: 640, height: 360 });

export default function Image({ slots, params }: ComponentRenderProps) {
  const src = typeof slots.src === 'string' ? slots.src : '';
  return (
    <div style={mediaFrame(params)}>
      {src ? (
        <img src={src} alt={String(params.alt ?? '')} draggable={false}
          style={{ width: '100%', height: '100%', objectFit: mediaFit(params.fit), pointerEvents: 'none' }} />
      ) : (
        <div style={{ height: '100%', display: 'grid', placeItems: 'center', border: '2px dashed #888', boxSizing: 'border-box' }}>
          Set image source
        </div>
      )}
    </div>
  );
}
