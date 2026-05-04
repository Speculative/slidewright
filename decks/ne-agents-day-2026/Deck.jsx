import { Slide } from '../../src/Slide.jsx';
import { CodeBlock } from '../../src/CodeBlock.jsx';
import timeTravelImg from './time_travel.png';
import notebookSetupImg from './notebook_setup.png';
import notebookInteractiveImg from './notebook_interactive.png';
import headshotImg from './headshot.jpg';

export const meta = {
  name: 'NE AGENTS DAY',
  subtitle: '2026',
  setupLabel: 'Vibe Debugging with autopsy-report',
};

const QUERY_CODE = `# every window_start value, in order
(
    trace.events()
    .filter(
        pl.col("var_name") == "window_start"
    )
    .sort("seq")
    .select("seq", "value")
)`;

const SESSIONIZE_CODE = `def sessionize(events, gap_seconds=1800):
    if not events:
        return []
    events = sorted(events, key=lambda e: e["t"])

    sessions = []
    current = [events[0]]
    window_start = events[0]["t"]

    for e in events[1:]:
        if e["t"] - window_start > gap_seconds:
            sessions.append(current)
            current = [e]
            window_start = e["t"]
        else:
            current.append(e)

    sessions.append(current)
    return sessions`;

export const slides = (
  <>
    <Slide
      label="Title"
      className="title-slide"
      notes={`
        - ~5 seconds. Walk past it.
        - "Hi, I'm Jeff. I work on debugging tools at Penn. This is some
          recent work on understanding agent-written code."
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
            Vibe Debugging with <br />
            <code style={{ color: 'var(--accent)' }}>autopsy-report</code>
          </div>
          <div style={{ marginTop: 48, fontSize: 36, maxWidth: 1500, color: 'var(--muted)' }}>
            <em>or: towards comprehending agent-written code</em>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <img
              src={headshotImg}
              alt=""
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                objectFit: 'cover',
              }}
            />
            <span>
              Jeffrey Tao <span style={{ color: 'var(--accent)' }}>·</span>{' '}
              Penn HCI Lab
            </span>
          </div>
        </div>
      </div>
    </Slide>

    <Slide
      label="Setup"
      notes={`
        - ~30 seconds. The hook. Hold the silence.
        - "I asked an agent for this. Here's the prompt. Here's the code.
          Tests pass."
        - (pause — let them read)
        - "Is it right?"
        - (pause again — don't answer)
        - Move on. Don't explain yet.
      `}
    >
      <div
        className="cols"
        style={{ gridTemplateColumns: '1fr 1.5fr', height: '100%' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="eyebrow">The setup</div>
          <div className="slide-title" style={{ marginBottom: 0 }}>
            Vibe coding.
          </div>
          <div className="card" style={{ margin: 'auto 0' }}>
            <div className="label">Prompt</div>
            <div
              className="body"
              style={{
                fontFamily: 'var(--font-display)',
                fontStyle: 'italic',
                fontSize: 40,
                lineHeight: 1.3,
                marginTop: 16,
              }}
            >
              “Write me a Python function to group a stream of events into
              sessions. Events within 30 minutes should be in the same
              session.”
            </div>
          </div>
        </div>
        <div className="card">
          <div className="label">Code</div>
          <div style={{ marginTop: 12 }}>
            <CodeBlock code={SESSIONIZE_CODE} fontSize={26} />
          </div>
        </div>
      </div>
    </Slide>

    <Slide
      label="The new problem"
      notes={`
        - ~60 seconds.
        - "When you wrote code by hand, it could have bugs, but it
          couldn't be fundamentally misaligned with what you wanted. You
          knew your intent — the code just didn't always match it."
        - "Now the agent writes the code. Prompts are lossy. The agent
          can write something that's correct for *some* interpretation,
          just not yours."
        - "Three things you can do. Test it — but tests only see outputs.
          Read it — but reading code tells you what *could* happen, not
          what *did*. Or observe it — actually run it and watch."
        - "We think Observe is the right answer. But it raises three
          problems."
      `}
    >
      <div className="eyebrow">The new problem</div>
      <div className="slide-title">
        You're not writing the code anymore.
      </div>
      <div style={{ fontSize: 32, marginBottom: 48 }}>
        Hand-written code can be buggy. Agent-written code can be buggy{' '}
        <em>and</em>{' '}misaligned: “correct” for some interpretation of your
        prompt, but maybe not yours. How do you verify it does what you
        want?
      </div>
      <div className="card-grid-3">
        <div className="card amber">
          <div className="label">Test</div>
          <h3>Check the outputs.</h3>
          <div className="body">
            You (or the agent) write tests, or you drive the code manually.
            Try to think about all of the cases. Have you covered
            everything?
          </div>
        </div>
        <div className="card red">
          <div className="label">Read</div>
          <h3>Review every line.</h3>
          <div className="body">
            Read the code yourself and internalize it. Be really careful
            and attentive. Do you properly understand how it behaves?
          </div>
        </div>
        <div className="card lime">
          <div className="label">Observe</div>
          <h3>Watch it run.</h3>
          <div className="body">
            Run the code and see what it actually does. Exercised behavior
            covers both the code and the tests — it's where alignment is
            visible.
          </div>
        </div>
      </div>
    </Slide>

    <Slide
      label="Three problems"
      notes={`
        - ~45 seconds.
        - "Behavior isn't a thing you can just look at."
        - "First, attention — programs do a lot, where do you point your
          eyes?"
        - "Second, volume — even when you know where to look, there's a
          firehose."
        - "Third, representation — behavior isn't directly visible.
          Something has to capture it and shape it into a form you can
          read."
        - "The rest of the talk is how autopsy-report addresses these
          three."
      `}
    >
      <div className="eyebrow">Three obstacles</div>
      <div className="slide-title">
        Behavior is hidden by default.
      </div>
      <div style={{ fontSize: 32, marginBottom: 48 }}>
        Programs do a lot, and most of it is invisible by default. To
        observe behavior, you have to solve three problems.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        <div
          className="card purple"
          style={{
            display: 'grid',
            gridTemplateColumns: '35rem 1fr',
            gap: 48,
            alignItems: 'center',
          }}
        >
          <div>
            <div className="label">Representation</div>
            <h3 style={{ marginBottom: 0 }}>Code isn't behavior.</h3>
          </div>
          <div className="body">
            Code shows what could happen, not what did. Behavior has to
            be captured and shaped into something you can read.
          </div>
        </div>
        <div
          className="card cyan"
          style={{
            display: 'grid',
            gridTemplateColumns: '35rem 1fr',
            gap: 48,
            alignItems: 'center',
          }}
        >
          <div>
            <div className="label">Attention</div>
            <h3 style={{ marginBottom: 0 }}>It's mostly noise.</h3>
          </div>
          <div className="body">
            Useful observations are buried within everything else that
            happens. Which parts actually matter?
          </div>
        </div>
        <div
          className="card magenta"
          style={{
            display: 'grid',
            gridTemplateColumns: '35rem 1fr',
            gap: 48,
            alignItems: 'center',
          }}
        >
          <div>
            <div className="label">Volume</div>
            <h3 style={{ marginBottom: 0 }}>There's too much stuff.</h3>
          </div>
          <div className="body">
            Even once you know where to look, the data is a veritable
            firehose. Logs scroll past, breakpoints fire on every
            iteration.
          </div>
        </div>
      </div>
    </Slide>

    <Slide
      label="Trace capture"
      notes={`
        - ~60 seconds.
        - "First problem: representation. Behavior is invisible by
          default. We make it into an artifact."
        - "An ambitious idea: capture everything. Every expression,
          every variable, every moment of execution."
        - Three pieces: capture cheap enough to keep on; an offline
          reassembly that turns the raw stream into a queryable
          artifact; and — falling out for free — random-access time
          travel.
        - "Here's what it looks like." (advance to screenshot)
      `}
    >
      <div className="eyebrow">Addressing Representation</div>
      <div className="slide-title">Make behavior into an artifact.</div>
      <div style={{ fontSize: 38, lineHeight: 1.4, marginBottom: 56 }}>
        An ambitious idea: capture <em>everything</em>. Every expression
        and statement, every stack frame, every variable, across time.
      </div>
      <div className="card-grid-3">
        <div className="card cyan">
          <div className="label">Hook</div>
          <h3>Capture in <code>cpython</code>.</h3>
          <div className="body">
            Hook the interpreter to record control flow and assignments
            in user code.{' '}
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
              ~2.2× overhead
            </span>
            : cheap enough to leave on in dev.
          </div>
        </div>
        <div className="card amber">
          <div className="label">Trace</div>
          <h3>Build the trace.</h3>
          <div className="body">
            Process the captured stream into a queryable artifact offline,
            making every event and value easily accessible.
          </div>
        </div>
        <div className="card lime">
          <div className="label">Replay</div>
          <h3>Time travel for free.</h3>
          <div className="body">
            Step forward, step backward, jump around, and inspect any moment by just
            looking it up in the trace.
          </div>
        </div>
      </div>
    </Slide>

    <Slide
      label="Trace capture: screenshot"
      chromeless
      notes={`
        - ~Continuation of trace-capture slide.
        - "Here's what we get for our sessionize example."
        - Stack frames on the left, source in the middle with execution
          markers, locals on the right. The arrow shows where in the
          trace we're parked; you can step forwards and backwards from
          any point.
        - "But this is a firehose. We can't just hand it to you."
      `}
    >
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="card" style={{ padding: 0, lineHeight: 0 }}>
          <img
            src={timeTravelImg}
            alt="Time-travel debugger view of sessionize trace"
            style={{
              display: 'block',
              maxWidth: 1860,
              maxHeight: 1024,
            }}
          />
        </div>
      </div>
    </Slide>

    <Slide
      label="Notebooks"
      notes={`
        - ~60 seconds.
        - "Second problem: attention. The trace is huge. Where do you
          look?"
        - "The same agent that wrote the code writes a notebook
          explaining it — but not in prose. The explanation is grounded
          in queries over the actual trace."
        - "Here's the notebook for sessionize." (point)
        - "It walks through what the function did on the inputs we gave
          it. The prose tells you the story; the queries are the
          evidence."
        - "But why should you trust this notebook?"
      `}
    >
      <div className="eyebrow">Addressing Attention</div>
      <div className="slide-title">Let the agent direct your gaze.</div>
      <div
        style={{
          fontSize: 36,
          lineHeight: 1.4,
          marginBottom: 56,
        }}
      >
        The agent writes both code and an{' '}
        <em>interactive explanation</em> of how it behaves, grounded in
        queries over the captured trace.
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 60,
          alignItems: 'stretch',
        }}
      >
        <div className="card red">
          <div className="label">Risk</div>
          <h3>Not just generated prose.</h3>
          <div className="body">
            LLMs author plausible text. Bugs and misalignment can hide in
            the explanation as easily as in the code itself.
          </div>
        </div>
        <div className="card cyan">
          <div className="label">Evidence</div>
          <h3>Show, don't tell.</h3>
          <div className="body">
            The agent shows you how the code runs. Prose, code, and real
            observed behavior help you easily check its work.
          </div>
        </div>
      </div>
    </Slide>

    <Slide
      label="Notebook: setup"
      chromeless
      notes={`
        - "Here's the notebook for sessionize. Top: title and a one-line
          intro — what the function is supposed to do."
        - "Below that: the function source. The agent wrote both the
          code and this walkthrough."
        - "Below that: the input we tested it on — alice browsing
          continuously, bob with two real sessions."
      `}
    >
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="card" style={{ padding: 0, lineHeight: 0 }}>
          <img
            src={notebookSetupImg}
            alt="Notebook: title, function source, input setup"
            style={{
              display: 'block',
              maxWidth: 1860,
              maxHeight: 1024,
            }}
          />
        </div>
      </div>
    </Slide>

    <Slide
      label="Queries + reveal"
      notes={`
        - ~30 seconds.
        - "Third piece. Even with the agent directing attention, the
          trace is still too much to look at raw."
        - "Queries pare it down — filter, project, summarize."
        - "And queries do a second job: they're short, declarative,
          and you can read them. The notebook isn't persuasive prose;
          it's a sequence of checkable claims."
        - (advance — set up that the next slide is one of those
          claims in action.)
      `}
    >
      <div className="eyebrow">Addressing Volume</div>
      <div className="slide-title">Filter and verify.</div>
      <div
        style={{
          fontSize: 32,
          lineHeight: 1.4,
          marginBottom: 40,
        }}
      >
        Queries do two things at once.
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 60,
          alignItems: 'stretch',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div className="card lime">
            <div className="label">Tractability</div>
            <h3>Pare the firehose down.</h3>
            <div className="body">
              Filter to relevant moments, project to relevant fields,
              summarize across iterations.
            </div>
          </div>
          <div className="card amber">
            <div className="label">Trust</div>
            <h3>Spot-check the work.</h3>
            <div className="body">
              Queries are short and declarative. Easy for the agent to
              write, easy for you to check.
            </div>
          </div>
        </div>
        <div className="card">
          <div className="label">Example query</div>
          <div style={{ marginTop: 16 }}>
            <CodeBlock code={QUERY_CODE} fontSize={28} />
          </div>
        </div>
      </div>
    </Slide>

    <Slide
      label="Notebook: interactive"
      chromeless
      notes={`
        - "Per-iteration table from sessionize. One row per pass
          through the loop."
        - "The 'decision' column — values 'extend' or 'new session'
          — isn't raw trace data. The agent's query derived it from
          the control-flow events of each iteration. That's the
          payoff: a column that reads like English but came from
          execution."
        - "Click any row; the code panel rebinds to that iteration."
        - (the misalignment.) "Look at window_start_before_iter:
          pinned to alice's first event for every row. gap climbs
          monotonically. Decision flips to 'new session' the moment
          the cumulative gap from session START exceeds 30 minutes —
          even though alice never stopped."
        - "The agent built a 30-minute *window* sessionizer. We
          wanted a 30-minute *gap* sessionizer. Reading the code
          wouldn't have caught this. The trace did, in one column."
      `}
    >
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="card" style={{ padding: 0, lineHeight: 0 }}>
          <img
            src={notebookInteractiveImg}
            alt="Notebook: per-iteration table bound to source panel"
            style={{
              display: 'block',
              maxWidth: 1860,
              maxHeight: 1024,
            }}
          />
        </div>
      </div>
    </Slide>

    <Slide
      label="Conclusion"
      className="title-slide"
      notes={`
        - Land on the thesis. Hold the silence.
        - "Review the trace, not the diff. Thanks."
        - Take questions.
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
            <span style={{ color: 'var(--accent)' }}>Review the trace,</span>
            <br />
            not the diff.
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <img
              src={headshotImg}
              alt=""
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                objectFit: 'cover',
              }}
            />
            <span>
              Jeffrey Tao <span style={{ color: 'var(--accent)' }}>·</span>{' '}
              Penn HCI Lab
            </span>
          </div>
        </div>
      </div>
    </Slide>
  </>
);
