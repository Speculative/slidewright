// Slide primitives. <Presentation> is the runtime that walks these,
// derives slide indices + act metadata, and toggles which one is active;
// <Slide> and <Section> are just the content shapes.
import {
  Children,
  Fragment,
  createContext,
  isValidElement,
  useContext,
} from 'react';

export const DeckMetaContext = createContext({
  name: '',
  subtitle: '',
  total: 0,
});

// Children.toArray treats a top-level <>...</> as a single Fragment element
// rather than unwrapping it. Walk fragments so deck authors can write
// `<>{slide1}{slide2}</>` and we still see the actual slides.
export function flattenSlides(children) {
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

// One string per slide, in order. Empty string when a slide has no notes,
// so positional indexing into the array stays aligned with slide index.
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

// idx, actLabel, actNum, active are injected by <Presentation>; authors
// don't pass them. `notes` is read by extractNotes() and ignored here.
export function Slide({
  idx,
  label,
  sectionStyle,
  className,
  actLabel,
  notes,
  active,
  children,
}) {
  void notes;
  const { name, subtitle, total } = useContext(DeckMetaContext);
  const cls =
    'slide' +
    (sectionStyle ? ' section-slide' : '') +
    (active ? ' active' : '') +
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
  active,
}) {
  return (
    <Slide
      idx={idx}
      label={label}
      sectionStyle
      actLabel={actLabel}
      notes={notes}
      active={active}
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
