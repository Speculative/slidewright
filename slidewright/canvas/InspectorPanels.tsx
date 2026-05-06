// Slidewright canvas — inspector panels (hierarchy + properties).
//
// Lives in App's bottom strip alongside the optional bottomExtra
// slot (the standalone fills it with EditorPane). Three-column
// layout mirrors browser DevTools: DOM tree | computed styles |
// source. Hierarchy is wired (read-only tree + selection sync);
// the property panel is a placeholder until v0.3 stage 3.

import { useMemo } from 'react';
import type { ReactElement } from 'react';

import type { ShapeData } from '../runtime/loader.js';
import type { SourceRange } from './host.js';

interface HierarchyPanelProps {
  shapes: ReadonlyMap<string, ShapeData>;
  activeIdx: number;
  selected: readonly SourceRange[];
  onSelect: (range: SourceRange, modifiers: { shift: boolean }) => void;
  onJumpToSource: (range: SourceRange) => void;
}

export function HierarchyPanel({
  shapes,
  activeIdx,
  selected,
  onSelect,
  onJumpToSource,
}: HierarchyPanelProps): ReactElement {
  // Active slide's shapes, ordered by childIdx so the tree matches
  // source / render order in the Freeform.
  const items = useMemo(() => {
    const list: ShapeData[] = [];
    for (const data of shapes.values()) {
      if (data.slideIdx === activeIdx) list.push(data);
    }
    list.sort((a, b) => a.childIdx - b.childIdx);
    return list;
  }, [shapes, activeIdx]);

  const isSelected = (data: ShapeData): boolean => {
    const start = data.comp.span.start.offset;
    const end = data.comp.span.end.offset;
    return selected.some((s) => s.start === start && s.end === end);
  };

  return (
    <div className="sw-inspector-panel sw-hierarchy-panel">
      <div className="sw-inspector-panel-header">Hierarchy</div>
      <div className="sw-inspector-panel-body">
        {items.length === 0 ? (
          <div className="sw-inspector-panel-empty">
            (no shapes on this slide)
          </div>
        ) : (
          <ul className="sw-hierarchy-tree" role="tree">
            {items.map((data) => {
              const range: SourceRange = {
                start: data.comp.span.start.offset,
                end: data.comp.span.end.offset,
              };
              const sel = isSelected(data);
              return (
                <li
                  key={`${range.start}-${range.end}`}
                  className={
                    'sw-hierarchy-node' + (sel ? ' selected' : '')
                  }
                  role="treeitem"
                  aria-selected={sel}
                  data-sw-span-start={range.start}
                  data-sw-span-end={range.end}
                  onClick={(e) =>
                    onSelect(range, { shift: e.shiftKey })
                  }
                  onDoubleClick={() => onJumpToSource(range)}
                >
                  <span className="sw-hierarchy-node-name">
                    {data.comp.name}
                  </span>
                  <span className="sw-hierarchy-node-meta">
                    #{data.childIdx}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function PropertiesPanel(): ReactElement {
  return (
    <div className="sw-inspector-panel sw-properties-panel">
      <div className="sw-inspector-panel-header">Properties</div>
      <div className="sw-inspector-panel-body sw-inspector-panel-empty">
        (placeholder)
      </div>
    </div>
  );
}
