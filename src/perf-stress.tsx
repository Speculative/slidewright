// Per-frame setState perf test.
//
// Tests whether the proposed React-native-gesture architecture
// (gesture state in React, per-frame setState on pointermove,
// shape positions = pure function of state) sustains 60fps at
// slide-scale shape counts.
//
// Renders N shapes whose `left` / `top` are computed from a
// single `delta` state. requestAnimationFrame ticks the delta to
// force a render every frame. Frame times are logged to a
// `__perfStats` global that an outer test harness reads.
//
// URL params:
//   ?n=50      — number of shapes (default 50)
//   ?frames=300 — number of frames to measure (default 300, ~5s)
//
// Run manually via dev server (/perf.html?n=50) or via the
// Playwright harness in tests/perf-stress.spec.ts which sweeps N
// and reports.

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

interface PerfStats {
  n: number;
  frames: number;
  totalMs: number;
  avgFrameMs: number;
  p95FrameMs: number;
  fps: number;
  done: boolean;
}

const params = new URLSearchParams(window.location.search);
const N = parseInt(params.get('n') ?? '50', 10);
const FRAMES = parseInt(params.get('frames') ?? '300', 10);

function PerfTest(): ReactElement {
  const [delta, setDelta] = useState({ x: 0, y: 0 });
  const [stats, setStats] = useState<PerfStats | null>(null);

  useEffect(() => {
    let frame = 0;
    let lastTimestamp: number | null = null;
    const frameTimes: number[] = [];
    let rafId = 0;

    const tick = (timestamp: number) => {
      if (lastTimestamp !== null) {
        frameTimes.push(timestamp - lastTimestamp);
      }
      lastTimestamp = timestamp;

      // Vary delta with each frame to force re-render. Modulo so
      // shapes stay in viewport.
      setDelta({ x: frame % 100, y: (frame * 2) % 100 });
      frame++;

      if (frame < FRAMES) {
        rafId = requestAnimationFrame(tick);
      } else {
        // Compute stats. Skip the first sample (no prior timestamp
        // to subtract from). p95 = 95th percentile.
        const sorted = [...frameTimes].sort((a, b) => a - b);
        const total = frameTimes.reduce((a, b) => a + b, 0);
        const avg = total / frameTimes.length;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? avg;
        const out: PerfStats = {
          n: N,
          frames: frameTimes.length,
          totalMs: total,
          avgFrameMs: avg,
          p95FrameMs: p95,
          fps: 1000 / avg,
          done: true,
        };
        setStats(out);
        // Hand off to any outer harness watching the global.
        (window as unknown as { __perfStats: PerfStats }).__perfStats = out;
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Render N shapes laid out in a grid. Position = base + delta
  // — every shape re-positions every frame as `delta` changes.
  const cols = Math.ceil(Math.sqrt(N));
  const shapes: ReactElement[] = [];
  for (let i = 0; i < N; i++) {
    const baseX = (i % cols) * 80 + 20;
    const baseY = Math.floor(i / cols) * 80 + 20;
    shapes.push(
      <div
        key={i}
        style={{
          position: 'absolute',
          left: baseX + delta.x,
          top: baseY + delta.y,
          width: 60,
          height: 60,
          background: `hsl(${(i * 23) % 360}, 70%, 60%)`,
          border: '1px solid rgba(0, 0, 0, 0.4)',
          boxSizing: 'border-box',
        }}
      />,
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        background: '#f4f4f4',
        overflow: 'hidden',
      }}
    >
      {shapes}
      <div
        // Stats panel, also queryable by the test harness.
        data-perf-stats={stats ? 'done' : 'pending'}
        style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          padding: '8px 12px',
          background: '#fff',
          border: '1px solid #888',
          borderRadius: 4,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 13,
          whiteSpace: 'pre',
        }}
      >
        {stats
          ? `N=${stats.n}\n` +
            `frames=${stats.frames}\n` +
            `avg=${stats.avgFrameMs.toFixed(2)}ms (${stats.fps.toFixed(1)} fps)\n` +
            `p95=${stats.p95FrameMs.toFixed(2)}ms`
          : `N=${N}\nrunning…`}
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(<PerfTest />);
