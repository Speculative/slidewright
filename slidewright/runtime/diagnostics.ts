// Slidewright-friendly diagnostics. Both the parser and the validator
// emit Diagnostic records; the CLI and the dev-server overlay format
// them for display.
//
// SLIDEWRIGHT.md / AI authoring requires structured error-kind tags so
// agents can act on diagnostics without scraping prose.

import type { Span } from './ast.js';

export type DiagnosticKind =
  | 'parse'
  | 'lex'
  | 'duplicate-slot'
  | 'unknown-slot'
  | 'missing-required-slot'
  | 'slot-type-mismatch'
  | 'unknown-reference'
  | 'unknown-component'
  | 'invalid-implicit-children'
  | 'asset-not-found'
  | 'component-load-error';

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  kind: DiagnosticKind;
  severity: Severity;
  message: string;
  hint?: string;
  span: Span;
  file: string;
}

export function formatDiagnostic(d: Diagnostic): string {
  const { line, column } = d.span.start;
  const head = `${d.file}:${line}:${column}: ${d.severity} [${d.kind}] ${d.message}`;
  return d.hint ? `${head}\n  hint: ${d.hint}` : head;
}

export class SlidewrightError extends Error {
  diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    const summary = diagnostics
      .slice(0, 3)
      .map(formatDiagnostic)
      .join('\n');
    const more =
      diagnostics.length > 3 ? `\n…and ${diagnostics.length - 3} more` : '';
    super(`Slidewright: ${diagnostics.length} diagnostic(s)\n${summary}${more}`);
    this.name = 'SlidewrightError';
    this.diagnostics = diagnostics;
  }
}
