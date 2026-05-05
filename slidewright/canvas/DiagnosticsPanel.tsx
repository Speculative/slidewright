// Slidewright canvas — DiagnosticsPanel.
//
// Renders parser/validator diagnostics inline above the canvas when
// the deck doesn't parse cleanly. Severity-aware coloring is in
// canvas.css.

import type { ReactElement } from 'react';
import {
  formatDiagnostic,
  type Diagnostic,
} from '../runtime/diagnostics.js';

export function DiagnosticsPanel({
  diagnostics,
}: {
  diagnostics: Diagnostic[];
}): ReactElement | null {
  if (diagnostics.length === 0) return null;
  const severity = diagnostics.some((d) => d.severity === 'error')
    ? 'error'
    : 'warning';
  return (
    <pre className="sw-canvas-diagnostics" data-severity={severity}>
      {diagnostics.map(formatDiagnostic).join('\n')}
    </pre>
  );
}
