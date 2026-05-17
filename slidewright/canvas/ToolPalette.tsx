// Slidewright canvas — tool palette.
//
// Compact floating UI in a corner of the canvas for switching
// between modal gestures (Select / draw a Box / etc.). Modal-tool
// state lives in App as `activeTool`; this component is purely
// presentational + emits the user's tool choice.
//
// The entry list is registry-driven: the parent (App) walks the
// component registry, filters to components that opt into the
// 'modal' gesture via `meta.insertion`, and passes them in here.
// 'select' is always the first entry. Categories + search arrive
// in later steps; for now entries render as a flat list in their
// supplied order.

import type { ReactElement } from 'react';

// Identifier of the active tool. 'select' is the no-tool state;
// any other string is a component name (registry key).
export type Tool = string;
export const SELECT_TOOL = 'select';

// One entry in the tool palette beyond 'select' — derived from a
// component's `slidewright` metadata at the call site.
export interface ToolEntry {
  // Component-registry key. Used as the tool identifier and as
  // the lookup key when the create-gesture dispatches the
  // component's insertion stub.
  id: string;
  // Display name. Defaults to the component name.
  label: string;
  // Tooltip / search-target text.
  description?: string;
  // Section heading. Used by the categorized layout in a later
  // step; ignored by today's flat rendering.
  category?: string;
}

interface Props {
  active: Tool;
  tools: ToolEntry[];
  onSelect: (tool: Tool) => void;
}

export function ToolPalette({
  active,
  tools,
  onSelect,
}: Props): ReactElement {
  return (
    <div className="sw-tool-palette" role="toolbar" aria-label="Drawing tools">
      <button
        type="button"
        className={'sw-tool' + (active === SELECT_TOOL ? ' active' : '')}
        aria-pressed={active === SELECT_TOOL}
        title="Select (V)"
        aria-keyshortcuts="V"
        onClick={() => onSelect(SELECT_TOOL)}
      >
        Select
      </button>
      {tools.map((t) => (
        <button
          key={t.id}
          type="button"
          className={'sw-tool' + (active === t.id ? ' active' : '')}
          aria-pressed={active === t.id}
          title={t.description ? `${t.label} — ${t.description}` : t.label}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
