// TextBox shape primitive.
//
// Absolutely-positioned text container inside a Freeform parent.
// Position (x, y) and size (width, height) are slide-design-space
// pixels — same coordinate system as Box. Content is an ordered
// text document of Paragraph and List blocks, with source-backed
// inline strings and styled runs.
//
// Width/height authored without a sizing mode retain legacy fixed sizing.
// New boxes grow to their content until the author chooses a constrained mode.

import {
  useLayoutEffect,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  acceptsTargetSlot,
  type ComponentMeta,
  type ComponentRenderProps,
} from '../../../slidewright/runtime/contract.js';
import {
  makeComponent,
  numberLit,
  slotFill,
  stringLit,
  paragraphDocument,
} from '../../../slidewright/runtime/ast-builders.js';
import { makeTextBoxAdapter, textBoxSizing } from '../../../slidewright/canvas/textbox-adapter.js';
import { TextDocumentEditorContext } from '../../../slidewright/canvas/text-document-context.js';

export const slidewright: ComponentMeta = {
  produces: 'block',
  editor: { inspector: ['x', 'y', 'width', 'height'] },
  slots: {
    content: { type: 'text-document', required: false },
  },
  params: {
    x: { type: 'number', default: 0 },
    y: { type: 'number', default: 0 },
    width: { type: 'number' },
    height: { type: 'number' },
    sizing: { type: 'string' },
    font: { type: 'font-token', default: 'body' },
    fontSize: { type: 'number', default: 32 },
    fontWeight: { type: 'string', default: '400' },
    lineHeight: { type: 'number', default: 1.25 },
    letterSpacing: { type: 'number', default: 0 },
    align: { type: 'string', default: 'left' },
    wrap: { type: 'boolean', default: true },
    shrinkToFit: { type: 'boolean', default: false },
    color: { type: 'color-token', default: 'fg' },
  },
  protocols: {},
  category: 'Shapes',
  description: 'Absolutely-positioned text region.',
  insertion: {
    gestures: ['modal'],
    modalPlacement: 'point',
    stub: (ctx) => {
      if (!ctx.rect) return null;
      if (!acceptsTargetSlot('block', ctx.targetSlotType)) return null;
      const { x, y } = ctx.rect;
      return makeComponent('TextBox', [
        slotFill('x', numberLit(Math.round(x))),
        slotFill('y', numberLit(Math.round(y))),
        slotFill('sizing', stringLit('auto-width')),
        slotFill('font', stringLit('body')),
        slotFill('fontSize', numberLit(32)),
        slotFill('fontWeight', stringLit('400')),
        slotFill('lineHeight', numberLit(1.25)),
        slotFill('letterSpacing', numberLit(0)),
        slotFill('align', stringLit('left')),
        slotFill('content', paragraphDocument('')),
      ]);
    },
  },
};

export default function TextBox({ slots, params }: ComponentRenderProps) {
  const editor = useContext(TextDocumentEditorContext);
  const x = (params.x as number | undefined) ?? 0;
  const y = (params.y as number | undefined) ?? 0;
  const width = (params.width as number | undefined) ?? 320;
  const height = (params.height as number | undefined) ?? 120;
  const sizing = textBoxSizing(params);
  const fixedWidth = sizing !== 'auto-width';
  const fixedHeight = sizing === 'fixed';
  const requestedFontSize = (params.fontSize as number | undefined) ?? 32;
  const font = (params.font as string | undefined) ?? 'body';
  const fontWeight = (params.fontWeight as string | undefined) ?? '400';
  const lineHeight = (params.lineHeight as number | undefined) ?? 1.25;
  const letterSpacing = (params.letterSpacing as number | undefined) ?? 0;
  const align = (params.align as string | undefined) ?? 'left';
  const wrap = (params.wrap as boolean | undefined) ?? true;
  const shrinkToFit = (params.shrinkToFit as boolean | undefined) ?? false;
  const color = (params.color as string | undefined) ?? 'var(--fg)';
  const content = slots.content as ReactNode | undefined;
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [fontSize, setFontSize] = useState(requestedFontSize);

  // Fit is deliberately derived from the rendered DOM: it handles mixed
  // runs, browser font metrics, wrapping, and lists uniformly. The AST
  // keeps the requested size; fitting is a non-destructive presentation
  // policy, so turning it off restores that exact source value.
  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner || !shrinkToFit || !fixedHeight) {
      setFontSize(requestedFontSize);
      return;
    }
    const fit = (): void => {
      let candidate = requestedFontSize;
      inner.style.fontSize = `${candidate}px`;
      while (
        candidate > 8 &&
        (inner.scrollHeight > inner.clientHeight + 0.5 ||
          inner.scrollWidth > inner.clientWidth + 0.5)
      ) {
        candidate -= 0.5;
        inner.style.fontSize = `${candidate}px`;
      }
      setFontSize(candidate);
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(inner);
    const mutations = new MutationObserver(fit);
    mutations.observe(inner, { childList: true, characterData: true, subtree: true });
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [requestedFontSize, shrinkToFit, width, height, wrap, fixedHeight]);

  const fontFamily = ['body', 'display', 'mono'].includes(font)
    ? `var(--font-${font})`
    : font;
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: fixedWidth ? `${width}px` : 'max-content',
        minWidth: fixedWidth ? undefined : '16px',
        height: fixedHeight ? `${height}px` : 'auto',
        boxSizing: 'border-box',
        color: color,
        overflow: 'hidden',
      }}
    >
      <div
        ref={innerRef}
        data-sw-textbox-content="true"
        style={{
          width: '100%',
          height: fixedHeight ? '100%' : 'auto',
          minHeight: fixedHeight ? undefined : `${requestedFontSize * lineHeight + 16}px`,
          padding: '8px',
          boxSizing: 'border-box',
          overflow: 'hidden',
          fontFamily,
          fontSize: `${fontSize}px`,
          fontWeight,
          lineHeight,
          letterSpacing: `${letterSpacing}px`,
          textAlign: align as 'left' | 'center' | 'right' | 'justify',
          whiteSpace: wrap ? 'pre-wrap' : 'pre',
          overflowWrap: wrap ? 'break-word' : 'normal',
        }}
      >
        {editor ?? content}
      </div>
    </div>
  );
}

export const canvas = makeTextBoxAdapter();
