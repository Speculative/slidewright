// Slide framework. Per-deck files compose <Slide> and <Section> elements
// inside a fragment; <DeckRoot> walks them at render time to inject indices
// and act metadata, so deck authors never write `idx={N}` or `actNum={N}`.
import {
  Children,
  Fragment,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
} from 'react';

// Children.toArray treats a top-level <>...</> as a single Fragment element
// rather than unwrapping it, so a deck written as `<>{slide1}{slide2}</>`
// would be processed as one child. Walk fragments recursively to surface
// the actual slide elements.
function flattenSlides(children) {
  const out = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) {
      out.push(...flattenSlides(child.props.children));
    } else {
      out.push(child);
    }
  });
  return out;
}

const DeckMetaContext = createContext({ name: '', subtitle: '', total: 0 });

// Wrap a deck's slides. Reads the children, derives:
//   - idx (1-based) injected into each slide
//   - actLabel + actNum, advanced by each <Section> child
// and provides deck-wide name/subtitle/total via context for chrome.
export function DeckRoot({ name, subtitle, setupLabel = 'Setup', children }) {
  const slides = flattenSlides(children);
  const total = slides.length;

  let actLabel = setupLabel;
  let actNum = null;
  let actCounter = 0;
  const perSlide = slides.map((child) => {
    if (child.type === Section) {
      actCounter += 1;
      actNum = actCounter;
      actLabel = child.props.actLabel || `Act ${actCounter}`;
    }
    return { actLabel, actNum };
  });

  return (
    <DeckMetaContext.Provider value={{ name, subtitle, total }}>
      {slides.map((child, i) =>
        cloneElement(child, {
          idx: i + 1,
          actLabel: perSlide[i].actLabel,
          actNum: perSlide[i].actNum,
        })
      )}
    </DeckMetaContext.Provider>
  );
}

// Pulls the `notes` prop off each top-level slide, in order. Returns one
// string per slide (empty string if none), so positional indexing into the
// array still aligns with deck-stage's slide index.
export function extractNotes(children) {
  return flattenSlides(children).map((child) =>
    dedent(child.props.notes || '')
  );
}

// Strip leading/trailing blank lines and the common leading whitespace, so
// notes written as template literals indented to match the surrounding JSX
// render with their intended structure.
function dedent(s) {
  if (!s) return '';
  const lines = String(s).replace(/^\n+|\n+$/g, '').split('\n');
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.match(/^[ \t]*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
}

// idx, actLabel, actNum are injected by <DeckRoot>; authors don't pass them.
// `notes` is read by extractNotes() and ignored here.
export function Slide({
  idx,
  label,
  sectionStyle,
  className,
  actLabel,
  notes,
  children,
}) {
  void notes;
  const { name, subtitle, total } = useContext(DeckMetaContext);
  const cls =
    'slide' +
    (sectionStyle ? ' section-slide' : '') +
    (className ? ' ' + className : '');
  const screenLabel = String(idx).padStart(2, '0') + ' ' + (label || '');
  return (
    <section className={cls} data-screen-label={screenLabel}>
      <div className="slide-inner">{children}</div>
      <div className="chrome">
        <div className="crumb">
          {name} <span className="sep">//</span> {subtitle}{' '}
          <span className="sep">//</span> {actLabel}
        </div>
        <div className="page">
          {String(idx).padStart(String(total).length, '0')} / {total}
        </div>
      </div>
    </section>
  );
}

// Inverted section-divider slide. Acts as the boundary that increments
// the deck's act counter.
//   actLabel — label shown in the chrome footer for this act onward
//   titleLines / subtitle — React children, can include <br/>, <span>, etc.
export function Section({
  idx,
  label,
  actLabel,
  actNum,
  titleLines,
  subtitle,
  notes,
}) {
  return (
    <Slide
      idx={idx}
      label={label}
      sectionStyle
      actLabel={actLabel}
      notes={notes}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          height: '100%',
        }}
      >
        <div className="act-num">ACT {String(actNum).padStart(2, '0')}</div>
        <div className="title-xxl">{titleLines}</div>
        {subtitle ? (
          <div
            style={{
              marginTop: 40,
              fontSize: 36,
              maxWidth: 1400,
              color: 'var(--fg)',
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </Slide>
  );
}
