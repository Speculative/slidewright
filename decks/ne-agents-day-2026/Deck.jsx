import { Slide, Section } from '../../src/Slide.jsx';

export const meta = {
  name: 'NE AGENTS DAY',
  subtitle: '2026',
};

export const slides = (
  <>
    <Slide
      label="Title"
      className="title-slide"
      notes={`
        - Welcome / thank organizers
        - Introduce self and affiliation
        - Preview the thesis in one sentence
      `}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          height: '100%',
        }}
      >
        <div className="eyebrow">NE AGENTS DAY · 2026</div>
        <div>
          <div className="accent-rule"></div>
          <div className="title-xl">
            Vibe Debugging with <br /><code>autopsy-report</code>
          </div>
          <div style={{ marginTop: 48, fontSize: 36, maxWidth: 1200 }}>
            A one-line subtitle or thesis statement.
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            fontFamily: 'var(--font-mono)',
            fontSize: 24,
          }}
        >
          <div>
            Jeff Tao <span style={{ color: 'var(--accent)' }}>·</span>{' '}
            University of Pennsylvania
          </div>
        </div>
      </div>
    </Slide>

    <Section
      label="Section divider"
      actLabel="Part One"
      titleLines={
        <>
          Section title
          <br />
          <span style={{ color: 'var(--accent)' }}>in two lines.</span>
        </>
      }
      subtitle="Optional one-line subtitle."
      notes={`- Section divider notes`}
    />

    <Slide
      label="Two-column content"
      notes={`
        - Talk through the left card
        - Then contrast with the right card
        - Land on the takeaway
      `}
    >
      <div className="eyebrow">Eyebrow label</div>
      <div className="slide-title">Content slide title.</div>
      <div className="cols">
        <div className="card">
          <div className="label">Left card</div>
          <h3>Heading.</h3>
          <div className="body">
            Body text in the signature card treatment — black border, offset
            accent shadow.
          </div>
        </div>
        <div className="card amber">
          <div className="label">Right card</div>
          <h3>Another heading.</h3>
          <div className="body">
            Card colors: <code>card</code>, <code>card.amber</code>,{' '}
            <code>card.cyan</code>, <code>card.magenta</code>,{' '}
            <code>card.lime</code>, <code>card.red</code>,{' '}
            <code>card.purple</code>, <code>card.inverted</code>.
          </div>
        </div>
      </div>
    </Slide>
  </>
);
