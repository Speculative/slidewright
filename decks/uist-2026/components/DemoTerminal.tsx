/** Shared terminal display for the opening build and state-time demonstration. */
export function DemoTerminal({ lines, fontSize = 22, title = 'Terminal' }: { lines: string[]; fontSize?: number; title?: string }) {
  return <div aria-label="Demo terminal" style={{ flex: 1, minWidth: 0, minHeight: 0, boxSizing: 'border-box', overflow: 'auto', padding: 16, borderRadius: 12, lineHeight: 1.625, background: 'var(--uist-surface, #111827)', color: 'var(--uist-ink, #4ade80)', fontFamily: 'var(--font-mono, monospace)', fontSize }}>
    {title && <strong>{title}</strong>}{lines.map((line, index) => <div key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minHeight: '1.625em' }}>{line}</div>)}
  </div>;
}
