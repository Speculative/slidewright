import { Highlight, type PrismTheme } from 'prism-react-renderer';

// Palette from the original talk's github-light theme in @shikijs/themes
// 3.23.0 (pinned by its lockfile). Prism supplies the existing browser lexer;
// execution/explanation scenes retain the original plain CodeOverlay treatment.
const githubLight: PrismTheme = {
  plain: { color: '#24292e', backgroundColor: '#fff' },
  styles: [
    { types: ['comment'], style: { color: '#6a737d' } },
    { types: ['keyword', 'operator'], style: { color: '#d73a49' } },
    { types: ['number', 'boolean', 'builtin'], style: { color: '#005cc5' } },
    { types: ['string'], style: { color: '#032f62' } },
    { types: ['function', 'class-name'], style: { color: '#6f42c1' } },
    { types: ['punctuation'], style: { color: '#24292e' } },
  ],
};

export function InitialDebuggerCode({ lines }: { lines: string[] }) {
  return <Highlight code={lines.join('\n')} language="python" theme={githubLight}>
    {({ tokens, getTokenProps, style }) => <div style={{ color: style.color }}>
      {tokens.map((line, index) => <div key={index} data-demo-code-line={index} style={{ whiteSpace: 'pre' }}>
        <span style={{ color: '#888' }}>{index + 1} </span>
        {line.map((token, tokenIndex) => <span key={tokenIndex} {...getTokenProps({ token })}>{token.content}</span>)}
      </div>)}
    </div>}
  </Highlight>;
}
