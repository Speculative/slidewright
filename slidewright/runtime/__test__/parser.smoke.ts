// Quick smoke tests for the parser. Run with `node --experimental-strip-types`
// or via tsx. Not a full test suite — just enough to catch regressions during
// v0.0 implementation.

import { parse } from '../parser.js';
import { formatDiagnostic } from '../diagnostics.js';

const cases: Array<{ name: string; src: string; expectErrors?: number }> = [
  {
    name: 'empty deck',
    src: 'Deck { }',
  },
  {
    name: 'title slide with mixed value types',
    src: `
Deck {
  slides: [
    TitleSlide {
      venue: "NE AGENTS DAY"
      title: [
        "Vibe Debugging with "
        Span { color: accent, font: mono, content: "autopsy-report" }
      ]
      subtitle: "or: towards comprehending agent-written code"
      presenter: "Jeffrey Tao"
      affiliation: "Penn HCI Lab"
      headshot: headshotImg
    }
  ]
}
`,
  },
  {
    name: 'adjacent string concatenation',
    src: `
ContentSlide {
  intro: "Programs do a lot, and most of it is invisible by default. "
         "To observe behavior, you have to solve three problems."
}
`,
  },
  {
    name: 'triple-quoted string with dedent',
    src: `
Slide {
  notes: """
    First line.
    Second line.
  """
}
`,
  },
  {
    name: 'implicit children',
    src: `
Freeform {
  Box { x: 100 }
  Arrow { y: 200 }
}
`,
  },
  {
    name: 'mixed body is an error',
    src: `
Bad {
  title: "x"
  Box { x: 100 }
}
`,
    expectErrors: 1,
  },
  {
    name: 'inline comma form',
    src: `Card { color: purple, eyebrow: "Representation", heading: "x" }`,
  },
];

let failures = 0;
for (const c of cases) {
  const { ast, diagnostics } = parse(c.src, `<smoke:${c.name}>`);
  const errs = diagnostics.filter((d) => d.severity === 'error');
  const expected = c.expectErrors ?? 0;
  const ok = errs.length === expected;
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${c.name}: expected ${expected} errors, got ${errs.length}`);
    for (const e of errs) console.log('  ', formatDiagnostic(e));
  } else {
    console.log(`OK   ${c.name}`);
  }
  // Light AST sanity: every test should produce at least one top-level
  // component (parser shouldn't bail out completely).
  if (ast.items.length === 0 && expected === 0) {
    failures += 1;
    console.log(`FAIL ${c.name}: no top-level items in AST`);
  }
}

if (failures > 0) {
  console.log(`\n${failures} failing case(s).`);
  process.exit(1);
} else {
  console.log('\nall smoke tests passed.');
}
