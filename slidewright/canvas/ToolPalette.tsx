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
// 'select' is always the first entry, ungrouped. The remaining
// entries are grouped by `category`:
//
//   - When ≥2 categories exist, each renders as a collapsible
//     section with a header; collapsed state persists in
//     localStorage so the user's layout survives reloads.
//   - When only 1 category exists, headers are hidden and the
//     entries render as a flat list. Today's modal-only toolbar
//     surfaces only `Shapes`, so this is the live shape. Step 6
//     surfaces drag-mode categories (`Layouts`, `Slides`) and the
//     headers light up automatically.
//
// Entries without a `category` fall into a synthetic `Other`
// group so the bucket count is well-defined even for partly
// classified registries.

import { useCallback, useMemo, useState } from 'react';
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
  // Section heading. Entries without one bucket into 'Other'.
  category?: string;
}

interface Props {
  active: Tool;
  tools: ToolEntry[];
  onSelect: (tool: Tool) => void;
}

const FALLBACK_CATEGORY = 'Other';
const COLLAPSE_STORAGE_KEY = 'slidewright.canvas.toolPalette.collapsed';

// Persist the set of collapsed categories. Stored as a JSON array
// of category names — small, debuggable, and forward-compatible
// with rename / removal (unknown names are ignored on read).
function readCollapsedState(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function writeCollapsedState(state: Set<string>): void {
  try {
    localStorage.setItem(
      COLLAPSE_STORAGE_KEY,
      JSON.stringify([...state]),
    );
  } catch {
    // Quota errors aren't worth crashing the toolbar over.
  }
}

interface Group {
  category: string;
  entries: ToolEntry[];
}

// Group entries by category, preserving insertion order both for
// the groups themselves (first sight of each category wins) and
// for entries within a group. Order is the deck author's
// `registry.ts` import order — a deliberate placement they can
// shuffle.
function groupByCategory(tools: ToolEntry[]): Group[] {
  const groups = new Map<string, ToolEntry[]>();
  for (const t of tools) {
    const cat = t.category ?? FALLBACK_CATEGORY;
    let bucket = groups.get(cat);
    if (!bucket) {
      bucket = [];
      groups.set(cat, bucket);
    }
    bucket.push(t);
  }
  return [...groups.entries()].map(([category, entries]) => ({
    category,
    entries,
  }));
}

export function ToolPalette({
  active,
  tools,
  onSelect,
}: Props): ReactElement {
  const groups = useMemo(() => groupByCategory(tools), [tools]);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsedState);
  const toggleCategory = useCallback((category: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      writeCollapsedState(next);
      return next;
    });
  }, []);

  // Headers only make sense when the user has more than one
  // bucket to navigate between. With a single bucket the section
  // chrome would be pure overhead.
  const showHeaders = groups.length > 1;

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
      {groups.map((g) => {
        const isCollapsed = showHeaders && collapsed.has(g.category);
        return (
          <div key={g.category} className="sw-tool-section">
            {showHeaders ? (
              <button
                type="button"
                className={
                  'sw-tool-section-header' +
                  (isCollapsed ? ' collapsed' : '')
                }
                aria-expanded={!isCollapsed}
                onClick={() => toggleCategory(g.category)}
              >
                <span className="sw-tool-section-chevron" aria-hidden>
                  {isCollapsed ? '▸' : '▾'}
                </span>
                {g.category}
              </button>
            ) : null}
            {!isCollapsed
              ? g.entries.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={
                      'sw-tool' + (active === t.id ? ' active' : '')
                    }
                    aria-pressed={active === t.id}
                    title={
                      t.description
                        ? `${t.label} — ${t.description}`
                        : t.label
                    }
                    onClick={() => onSelect(t.id)}
                  >
                    {t.label}
                  </button>
                ))
              : null}
          </div>
        );
      })}
    </div>
  );
}
