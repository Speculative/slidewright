// Slidewright canvas — tool palette.
//
// Compact floating UI in a corner of the canvas for switching
// between modal gestures (Select / draw a Box / etc.). Modal-tool
// state lives in App as `activeTool`; this component is purely
// presentational + emits the user's tool choice.
//
// v0.2.f ships Select + Box. v0.2.g+ adds Ellipse / Text / Arrow.
// Each tool is a separate entry rather than a polymorphic "shape"
// dropdown — clearer affordance, and the underlying gesture
// behavior may diverge per shape (e.g., text needs to enter edit
// mode immediately after creation).

import type { ReactElement } from 'react';

export type Tool = 'select' | 'box' | 'textbox' | 'arrow';

interface Props {
  active: Tool;
  onSelect: (tool: Tool) => void;
}

const TOOLS: Array<{ id: Tool; label: string; hint: string }> = [
  { id: 'select', label: 'Select', hint: 'V' },
  { id: 'box', label: 'Box', hint: 'B' },
  { id: 'textbox', label: 'Text', hint: 'T' },
  { id: 'arrow', label: 'Arrow', hint: 'A' },
];

export function ToolPalette({ active, onSelect }: Props): ReactElement {
  return (
    <div className="sw-tool-palette" role="toolbar" aria-label="Drawing tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={'sw-tool' + (active === t.id ? ' active' : '')}
          aria-pressed={active === t.id}
          aria-keyshortcuts={t.hint}
          title={`${t.label} (${t.hint})`}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
