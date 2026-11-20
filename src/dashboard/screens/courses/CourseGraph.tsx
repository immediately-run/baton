// CourseGraph.tsx — a course drawn as its stations and legs (B-212 item 2), from the pure
// layout (lib/courseLayout) and `course.show`'s `stations` and `legs`: a station is a node with
// its resting count; a leg is an edge whose state is a shape and a word before it is a colour —
// ▲ blocked, ● running, ↻ backing off, ○ ready — with its queue against `max_queue`. A blocked
// leg is a marked edge, never a station (R-BTN-126). SVG built as elements with text children
// only (§12.3); every node and edge is a focusable group with a name of its own. Station and
// leg names are the read's data: nothing here knows one.
import type { KeyboardEvent } from 'react';
import { courseLayout, type LayoutEdge } from '../../lib/courseLayout';
import { textOf } from '../../lib/Text';
import type { CourseLeg, CourseStation } from './types';

export type Picked = { kind: 'leg'; id: string } | { kind: 'station'; id: string };
export type LegMark = 'blocked' | 'running' | 'backing-off' | 'ready' | 'quiet';

export const LEG_GLYPH: Record<LegMark, string> = { blocked: '▲', running: '●', 'backing-off': '↻', ready: '○', quiet: '·' };
export const LEG_WORD: Record<LegMark, string> = { blocked: 'blocked', running: 'running', 'backing-off': 'backing off', ready: 'ready', quiet: 'nothing queued' };

const blockedCount = (leg: CourseLeg): number => (leg.state?.blocked ?? []).reduce((n, b) => n + (typeof b.count === 'number' ? b.count : 0), 0);

/** The one mark a leg's edge carries: blocked before running before backing off before ready. */
export function legMark(leg: CourseLeg | undefined): LegMark {
  if (!leg?.state) return 'quiet';
  if (blockedCount(leg) > 0) return 'blocked';
  if (leg.state.running > 0) return 'running';
  if (leg.state.backing_off > 0) return 'backing-off';
  if (leg.state.ready > 0) return 'ready';
  return 'quiet';
}

/** A leg's state in words: every count that is not zero, and its queue. */
export function legWords(leg: CourseLeg | undefined): string[] {
  if (!leg?.state) return [];
  const out: string[] = [];
  const blocked = blockedCount(leg);
  if (blocked) out.push(`${blocked} blocked`);
  if (leg.state.running) out.push(`${leg.state.running} running`);
  if (leg.state.backing_off) out.push(`${leg.state.backing_off} backing off`);
  if (leg.state.ready) out.push(`${leg.state.ready} ready`);
  if (leg.state.waiting) out.push(`${leg.state.waiting} waiting`);
  return out;
}

/** The same counts as the drawing writes them on an edge: each state's shape and its count.
 *  The shapes are named in the legend under the drawing and in words in the table beside it. */
export function legMarks(leg: CourseLeg | undefined): string {
  if (!leg?.state) return '';
  const out: string[] = [];
  const blocked = blockedCount(leg);
  if (blocked) out.push(`${LEG_GLYPH.blocked} ${blocked}`);
  if (leg.state.running) out.push(`${LEG_GLYPH.running} ${leg.state.running}`);
  if (leg.state.backing_off) out.push(`${LEG_GLYPH['backing-off']} ${leg.state.backing_off}`);
  if (leg.state.ready) out.push(`${LEG_GLYPH.ready} ${leg.state.ready}`);
  return out.join('  ');
}

export function queueWords(leg: CourseLeg | undefined): string | null {
  const q = leg?.queue;
  if (!q || q.max_queue == null) return null;
  return `queue ${q.depth} of ${q.max_queue}${q.over ? ' · intake closed' : ''}`;
}

const SIZES = {
  small: { colW: 132, rowH: 84, r: 12, font: 10, pad: 18, arc: 44, words: false },
  large: { colW: 176, rowH: 132, r: 17, font: 12, pad: 30, arc: 70, words: true },
} as const;

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function CourseGraph({ file, stations, legs, size = 'small', picked, onPick, label }: {
  file: unknown; stations: readonly CourseStation[]; legs: readonly CourseLeg[]; size?: 'small' | 'large';
  picked?: Picked | null; onPick?: (p: Picked) => void; label: string;
}) {
  const z = SIZES[size];
  const layout = courseLayout(file);
  const legOf = new Map(legs.map((l) => [l.leg, l]));
  const stationOf = new Map(stations.map((s) => [s.station, s]));
  const top = z.pad + (layout.hasSkip ? z.arc + 2 * (z.font + 2) : 0);
  const bodyH = layout.rows * z.rowH;
  const width = layout.cols * z.colW + 2 * z.pad;
  const height = top + bodyH + (layout.hasBack ? z.arc : 0) + z.pad;
  const px = (x: number) => z.pad + x * layout.cols * z.colW;
  const py = (y: number) => top + y * bodyH;
  const interactive = !!onPick;
  const act = (p: Picked) => ({
    role: interactive ? 'button' as const : 'img' as const,
    tabIndex: interactive ? 0 : undefined,
    'aria-pressed': interactive ? picked?.kind === p.kind && picked.id === p.id : undefined,
    onClick: interactive ? () => onPick!(p) : undefined,
    onKeyDown: interactive ? (e: KeyboardEvent<SVGGElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onPick!(p);
    } : undefined,
  });
  const markerId = `arrow-${size}`;

  const edge = (e: LayoutEdge, i: number) => {
    const leg = legOf.get(e.leg);
    const mark = legMark(leg);
    const over = leg?.queue?.over === true;
    const x1 = px(e.x1), y1 = py(e.y1), x2 = px(e.x2), y2 = py(e.y2);
    let d: string;
    let lx: number;
    let ly: number;
    if (e.kind === 'straight') {
      // From circle edge to circle edge; parallel edges bow apart.
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const bow = (e.nth - (e.of - 1) / 2) * (z.rowH * 0.5);
      const mx = (x1 + x2) / 2 - uy * bow, my = (y1 + y2) / 2 + ux * bow;
      d = bow === 0
        ? `M${x1 + ux * z.r},${y1 + uy * z.r} L${x2 - ux * (z.r + 5)},${y2 - uy * (z.r + 5)}`
        : `M${x1 + ux * z.r},${y1 + uy * z.r} Q${mx},${my + bow * 0.6} ${x2 - ux * (z.r + 5)},${y2 - uy * (z.r + 5)}`;
      lx = mx;
      ly = my + bow * 0.3;
    } else {
      // An arc over the row for an edge that skips a column, under it for one that goes back.
      const up = e.kind === 'skip';
      const lane = (up ? top - z.arc * 0.8 : top + bodyH + z.arc * 0.8) + (up ? -1 : 1) * e.nth * 4;
      const sy = up ? -1 : 1;
      d = `M${x1},${y1 + sy * z.r} C${x1},${lane} ${x2},${lane} ${x2},${y2 + sy * (z.r + 5)}`;
      lx = (x1 + x2) / 2;
      // The curve's own midpoint sits three quarters of the way to its lane.
      ly = ((y1 + y2) / 2 + sy * z.r) * 0.25 + lane * 0.75;
    }
    const words = legWords(leg);
    const queue = queueWords(leg);
    // The label's lines, stacked upward from the line so they clear the stations beside it:
    // the leg's name with its mark, the counts by shape, and the queue against its bound.
    const marks = legMarks(leg);
    const lines: { cls: string; glyph?: string; text: string }[] = [{ cls: 'cg-label', glyph: LEG_GLYPH[mark], text: clip(textOf(e.leg), size === 'small' ? 16 : 24) }];
    if (marks && (z.words || mark !== 'ready')) lines.push({ cls: 'cg-words', text: marks });
    if (queue && (z.words || over)) lines.push({ cls: 'cg-queue', text: z.words ? queue : 'intake closed' });
    // Three lines beside a station would run into it: they start above its circle instead.
    const lift = e.kind === 'straight' && lines.length > 2 ? z.r + 4 : 6;
    const name = `leg ${textOf(e.leg)}, from ${textOf(e.from)} to ${textOf(e.to)}: ${LEG_WORD[mark]}${words.length ? ` — ${words.join(', ')}` : ''}${queue ? `; ${queue}` : ''}`;
    return (
      <g key={`${e.leg}\u0000${e.from}\u0000${e.to}\u0000${i}`} className={`cg-edge cg-${mark}${over ? ' cg-over' : ''}`} aria-label={name} data-leg={e.leg} {...act({ kind: 'leg', id: e.leg })}>
        <path className="cg-hit" d={d} />
        <path className="cg-line" d={d} markerEnd={`url(#${markerId})`} />
        {lines.map((line, n) => (
          <text key={line.cls} className={line.cls} x={lx} y={ly - lift - (lines.length - 1 - n) * (z.font + 2)} textAnchor="middle" style={{ fontSize: n === 0 ? z.font : z.font - 1 }}>
            {line.glyph ? <tspan className="cg-glyph">{line.glyph} </tspan> : null}{line.text}
          </text>
        ))}
      </g>
    );
  };

  return (
    <div className={`cg-box cg-${size}`}>
      <svg className="cg-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={label}>
        <defs>
          <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto">
            <path className="cg-arrow" d="M0,0 L10,5 L0,10 z" />
          </marker>
        </defs>
        {layout.edges.map(edge)}
        {layout.stations.map((s) => {
          const st = stationOf.get(s.id);
          const resting = st ? st.resting : null;
          const name = `station ${textOf(s.id)}${st?.start ? ', the entry' : ''}${st?.end ? ', an end' : ''}: ${resting ?? 0} resting${st?.claimed ? `, ${st.claimed} under a claim` : ''}${st?.end ? `, ${st.arrived_today} arrived in 24 hours` : ''}`;
          return (
            <g key={s.id} className={`cg-node${st?.end ? ' cg-end' : ''}${st?.start ? ' cg-start' : ''}`} aria-label={name} data-station={s.id} {...act({ kind: 'station', id: s.id })}>
              <circle cx={px(s.x)} cy={py(s.y)} r={z.r} />
              {st?.end ? <circle className="cg-ring" cx={px(s.x)} cy={py(s.y)} r={z.r - 3.5} /> : null}
              <text className="cg-count" x={px(s.x)} y={py(s.y) + z.font * 0.36} textAnchor="middle" style={{ fontSize: z.font }}>{resting ?? '–'}</text>
              <text className="cg-name" x={px(s.x)} y={py(s.y) + z.r + z.font + 3} textAnchor="middle" style={{ fontSize: z.font }}>{clip(textOf(s.id), size === 'small' ? 18 : 28)}</text>
              {z.words && st ? <text className="cg-sub" x={px(s.x)} y={py(s.y) + z.r + 2 * z.font + 5} textAnchor="middle" style={{ fontSize: z.font - 1.5 }}>{st.end ? `${st.arrived_today} in 24 h` : 'resting'}</text> : null}
            </g>
          );
        })}
      </svg>
      <ul className="cg-legend" aria-label="Legend">
        {(['blocked', 'running', 'backing-off', 'ready'] as const).map((m) => <li key={m} className={`cg-key cg-key-${m}`}><span aria-hidden="true">{LEG_GLYPH[m]}</span> {LEG_WORD[m]}</li>)}
        <li className="cg-key">a station’s number: tickets resting there</li>
      </ul>
    </div>
  );
}
