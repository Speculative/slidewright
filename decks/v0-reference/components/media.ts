import type { CSSProperties } from 'react';
import { acceptsTargetSlot, type ComponentMeta } from '../../../slidewright/runtime/contract.js';
import { makeComponent, numberLit, slotFill, stringLit } from '../../../slidewright/runtime/ast-builders.js';

export function mediaMeta(name: 'Image' | 'Video'): ComponentMeta {
  return {
    produces: 'block',
    slots: { src: { type: 'image', required: true } },
    params: {
      x: { type: 'number', default: 0 },
      y: { type: 'number', default: 0 },
      width: { type: 'number', default: 640 },
      height: { type: 'number', default: 360 },
      fit: { type: 'string', default: 'contain' },
      radius: { type: 'number', default: 0 },
      ...(name === 'Image'
        ? { alt: { type: 'string' as const, default: '' } }
        : {
            label: { type: 'string' as const, default: 'Video' },
            loop: { type: 'boolean' as const, default: true },
            muted: { type: 'boolean' as const, default: true },
          }),
    },
    category: 'Media',
    description: name === 'Image' ? 'Positioned raster image or SVG.' : 'Positioned video with playback controls.',
    insertion: {
      gestures: ['modal'],
      stub: (ctx) => {
        if (!ctx.rect || !acceptsTargetSlot('block', ctx.targetSlotType)) return null;
        return makeComponent(name, [
          ...Object.entries(ctx.rect).map(([key, value]) => slotFill(key, numberLit(Math.round(value)))),
          slotFill('src', stringLit('')),
        ]);
      },
    },
  };
}

export function mediaFrame(params: Record<string, unknown>): CSSProperties {
  return {
    position: 'absolute',
    left: Number(params.x ?? 0),
    top: Number(params.y ?? 0),
    width: Number(params.width ?? 640),
    height: Number(params.height ?? 360),
    borderRadius: Math.max(0, Number(params.radius ?? 0)),
    overflow: 'hidden',
    boxSizing: 'border-box',
  };
}

export function mediaFit(value: unknown): CSSProperties['objectFit'] {
  return value === 'cover' || value === 'fill' ? value : 'contain';
}
