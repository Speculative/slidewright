import { Highlight, type PrismTheme } from 'prism-react-renderer';

// Palette from the original talk's github-light theme in @shikijs/themes
// 3.23.0 (pinned by its lockfile). Prism supplies the existing browser lexer;
// UIST branding substitutes the personal ink palette through scoped variables;
// other decks keep the original colors through the fallbacks below.
const githubLight: PrismTheme = {
  plain: { color: 'var(--uist-ink, #24292e)', backgroundColor: 'var(--uist-paper, #fff)' },
  styles: [
    { types: ['comment'], style: { color: 'var(--uist-muted, #6a737d)' } },
    { types: ['keyword', 'operator'], style: { color: 'var(--uist-ink, #d73a49)' } },
    { types: ['number', 'boolean', 'builtin'], style: { color: 'var(--uist-blue, #005cc5)' } },
    { types: ['string'], style: { color: 'var(--uist-blue, #032f62)' } },
    { types: ['function', 'class-name'], style: { color: 'var(--uist-ink, #6f42c1)' } },
    { types: ['punctuation'], style: { color: 'var(--uist-ink, #24292e)' } },
  ],
};

const colorful: PrismTheme = {
  plain: githubLight.plain,
  styles: [
    { types: ['comment'], style: { color: 'var(--uist-muted, #6a737d)' } },
    { types: ['keyword'], style: { color: 'var(--uist-purple, #8000ff)' } },
    { types: ['function', 'class-name', 'builtin'], style: { color: 'var(--uist-teal, #007d70)' } },
    { types: ['string'], style: { color: 'var(--uist-blue, #0000ff)' } },
    { types: ['number', 'boolean'], style: { color: 'var(--uist-orangeText, #a84f00)' } },
    { types: ['operator', 'punctuation'], style: { color: 'var(--uist-ink, #24292e)' } },
  ],
};

export function InitialDebuggerCode({ lines, highlightedLines = [], breakpointLine, activeLine, animateActiveLine = false, insertedLines = [], showInsertedLines = true, colorfulSyntax = false, onToggleLine }: { lines: string[]; highlightedLines?: number[]; breakpointLine?: number; activeLine?: number; animateActiveLine?: boolean; insertedLines?: number[]; showInsertedLines?: boolean; colorfulSyntax?: boolean; onToggleLine?(line: number): void }) {
  return <Highlight code={lines.join('\n')} language="python" theme={colorfulSyntax ? colorful : githubLight}>
    {({ tokens, getTokenProps, style }) => <div style={{ color: style.color, position: 'relative', isolation: 'isolate' }}>
      {animateActiveLine && activeLine !== undefined && <div aria-hidden="true" data-demo-line-highlight style={{ position: 'absolute', zIndex: -1, left: 0, right: 0, top: 0, height: '1.625em', borderRadius: 4, background: 'var(--uist-markerYellow, #fef08a)', transform: `translateY(${activeLine * 100}%)`, transition: 'transform 360ms ease-in-out', pointerEvents: 'none' }} />}
      {tokens.map((line, index) => {
        const insertionIndex = insertedLines.indexOf(index);
        const inserted = insertionIndex !== -1;
        const lineNumber = index + 1 - (showInsertedLines ? 0 : insertedLines.filter(line => line < index).length);
        return <div key={index} data-demo-code-line={index} data-demo-inserted-line={inserted ? showInsertedLines ? 'shown' : 'hidden' : undefined} aria-hidden={inserted && !showInsertedLines || undefined} data-demo-print-accent={highlightedLines.includes(index) || undefined} data-demo-paused-line={index === activeLine || undefined} style={{ whiteSpace: 'pre', background: highlightedLines.includes(index) || (!animateActiveLine && index === activeLine) ? 'var(--uist-markerYellow, #fef08a)' : undefined, borderRadius: 4, transition: 'background-color .3s', ...(inserted ? {
          height: showInsertedLines ? '1.625em' : 0,
          opacity: showInsertedLines ? 1 : 0,
          transform: showInsertedLines ? 'translateX(0)' : 'translateX(-.6em)',
          visibility: showInsertedLines ? 'visible' : 'hidden',
          overflow: 'hidden',
          transition: 'height 480ms ease-in-out, opacity 480ms ease-out, transform 480ms ease-out, visibility 480ms',
          transitionDelay: showInsertedLines ? `${insertionIndex * 220}ms` : '0ms',
        } : {}) }}>
        {breakpointLine !== undefined && <span data-demo-breakpoint-marker={index === breakpointLine || undefined} style={{ display: 'inline-block', width: '1.5em', color: 'var(--uist-danger, #dc2626)' }}>{index === breakpointLine ? '●' : ''}</span>}{onToggleLine ? <button type="button" aria-label={`Emphasize line ${lineNumber}`} aria-pressed={highlightedLines.includes(index)}
          onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
          onClick={event => { event.stopPropagation(); onToggleLine(lineNumber); }}
          style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--uist-muted, #888)', font: 'inherit', cursor: 'pointer', whiteSpace: 'pre' }}>{lineNumber} </button> : <span style={{ color: 'var(--uist-muted, #888)' }}>{lineNumber} </span>}
        {line.map((token, tokenIndex) => <span key={tokenIndex} {...getTokenProps({ token })}>{token.content}</span>)}
      </div>;
      })}
    </div>}
  </Highlight>;
}
