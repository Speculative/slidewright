/**
 * Slidewright DSL — brace-block grammar.
 *
 * Documentation file expressing the brace-block grammar in tree-sitter's
 * declarative form. **Tree-sitter is not in the Slidewright build**; the
 * runtime parser (slidewright/runtime/parser.ts) is hand-rolled
 * recursive descent that tracks this grammar. See SLIDEWRIGHT.md /
 * Mediation layer / Parser for the rationale and HANDOFF.md /
 * Tree-sitter investigation for the alternative we considered.
 *
 * Why this file exists in tree-sitter form: it's a precise
 * specification of the syntax independent of the runtime parser, and
 * it's the entry point if we ever re-open the tree-sitter question
 * (`npx tree-sitter generate` produces a working parser.c from it).
 *
 * Surface conventions (per SLIDEWRIGHT.md / Form):
 *   - Component invocations:  Name { body }       — always braces.
 *   - Slot fills:             name: value         — name lowercase, value
 *                                                  is a literal, name
 *                                                  reference, component
 *                                                  invocation, or list.
 *   - Capitalization:         Capitalized id      => component type.
 *                             lowercase id        => slot/param name OR
 *                                                   (in value position) a
 *                                                   name reference.
 *   - Inside { ... } and [ ... ]: items separated by newline OR comma —
 *                                                 see "Separator handling"
 *                                                 below.
 *   - Lists use [ ... ] (parallel to { ... }).
 *   - Triple-quoted strings: """..."""  (Python-style dedent at the AST
 *                                       layer, not the grammar).
 *   - Adjacent simple string literals concatenate at parse time — handled
 *                                       at the CST→AST mapping layer in
 *                                       slidewright/runtime/parser_ts.ts,
 *                                       not in the grammar.
 *   - Comments: //   (line)   and   block.
 *   - Indentation is purely cosmetic.
 *
 * ── Separator handling ────────────────────────────────────────────────
 * SLIDEWRIGHT.md spec is "items separated by newline OR comma." In a
 * tree-sitter grammar, whitespace (including newlines) is consumed by
 * `extras` and is invisible to grammar rules — making "newline as
 * separator" require an external scanner.
 *
 * Workaround: items inside `{}` and `[]` are unambiguous WITHOUT explicit
 * separators because:
 *   - A new slot fill always starts with `lower_ident` followed by `:`.
 *   - A new bare component always starts with `upper_ident`.
 *   - A list item always starts with a value-introducer (literal,
 *     identifier, `[`, etc.).
 * The grammar therefore accepts items separated by zero or more commas;
 * newlines are ignored. This is a conservative superset of the spec —
 * inputs the spec calls valid will all parse; some inputs the spec
 * doesn't endorse (no separator at all, inline) also parse, but that's
 * harmless. The hand-rolled bridge parser
 * (slidewright/runtime/parser.ts) takes the same posture.
 *
 * ── Implicit children ─────────────────────────────────────────────────
 * Per SLIDEWRIGHT.md, when a brace block contains *only* component
 * invocations (no slot fills), they are the containing component's
 * `children` slot. Enforced at the AST/validation layer — the grammar
 * accepts mixed bodies and the loader emits a diagnostic.
 */

module.exports = grammar({
  name: 'slidewright',

  // Trivia eaten between any two grammar tokens.
  extras: ($) => [/\s/, $.line_comment, $.block_comment],

  // The token used for keyword resolution (`true`, `false`, `null`).
  word: ($) => $.lower_ident,

  rules: {
    source_file: ($) => repeat($.component),

    // ── Component invocation ────────────────────────────────────────────
    component: ($) =>
      seq(
        field('name', $.upper_ident),
        field('body', $.brace_body),
      ),

    brace_body: ($) =>
      seq(
        '{',
        repeat(seq($._brace_item, optional(','))),
        '}',
      ),

    _brace_item: ($) => choice($.slot_fill, $.component),

    // ── Slot fill ───────────────────────────────────────────────────────
    slot_fill: ($) =>
      seq(
        field('name', $.lower_ident),
        ':',
        field('value', $._value),
      ),

    // ── Values ──────────────────────────────────────────────────────────
    _value: ($) =>
      choice(
        $.string,
        $.triple_string,
        $.number,
        $.boolean,
        $.null_lit,
        $.list,
        $.component,
        $.name_ref,
      ),

    list: ($) =>
      seq(
        '[',
        repeat(seq($._value, optional(','))),
        ']',
      ),

    // ── Identifiers ─────────────────────────────────────────────────────
    upper_ident: () => /[A-Z][A-Za-z0-9_]*/,
    lower_ident: () => /[a-z_][A-Za-z0-9_]*/,

    name_ref: ($) => $.lower_ident,

    // ── Literals ────────────────────────────────────────────────────────
    string: () =>
      seq(
        '"',
        repeat(choice(
          token.immediate(/[^"\\\n]+/),
          token.immediate(/\\./),
        )),
        '"',
      ),

    // Triple-quoted: any content that does not contain three consecutive
    // double quotes. We use a single token to keep the grammar
    // unambiguous; dedent happens in the AST mapper.
    triple_string: () =>
      token(seq(
        '"""',
        /([^"]|"[^"]|""[^"])*/,
        '"""',
      )),

    number: () => /-?\d+(\.\d+)?/,

    boolean: () => choice('true', 'false'),

    null_lit: () => 'null',

    // ── Comments ────────────────────────────────────────────────────────
    line_comment: () => token(seq('//', /[^\n]*/)),
    block_comment: () => token(seq(
      '/*',
      /([^*]|\*[^/])*/,
      '*/',
    )),
  },
});
