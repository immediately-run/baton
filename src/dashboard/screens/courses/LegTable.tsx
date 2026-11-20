// LegTable.tsx — a course's legs as a table (B-212 item 3): from → to, what the file says of
// each (kind, outputs, requires, timeout, retries) and what the read counted (state, queue, the
// window's median wait and run and its fail rate). Nothing is computed here: the figures are
// the read's. The table carries everything the drawing does.
import { Text } from '../../lib/Text';
import { Table } from '../../lib/ui';
import { LEG_GLYPH, LEG_WORD, legMark, legWords } from './CourseGraph';
import { fileLeg, percent, seconds, type CourseLeg } from './types';

export function LegTable({ file, legs, onPick }: { file: unknown; legs: readonly CourseLeg[]; onPick?: (leg: string) => void }) {
  return (
    <div className="legs-table">
    <Table
      label="The course’s legs"
      rows={legs}
      rowKey={(l) => l.leg}
      empty="The course file names no leg."
      columns={[
        { head: 'Leg', rowHeader: true, cell: (l) => (onPick ? <button type="button" className="btn btn-quiet" onClick={() => onPick(l.leg)}><Text mono value={l.leg} /></button> : <Text mono value={l.leg} />) },
        { head: 'From → to', cell: (l) => <><Text value={(l.from ?? []).join(', ')} /> → <Text value={(l.to ?? []).join(', ')} /></> },
        { head: 'State', cell: (l) => {
          const mark = legMark(l);
          const words = legWords(l);
          return <span className={`leg-state leg-${mark}`}><span aria-hidden="true">{LEG_GLYPH[mark]} </span>{words.length ? words.join(' · ') : LEG_WORD[mark]}</span>;
        } },
        { head: 'Queue', cell: (l) => (
          <span className={l.queue?.over ? 'tone-warn' : undefined}>
            {l.queue?.depth ?? 0}{l.queue?.max_queue != null ? <> of {l.queue.max_queue}</> : null}{l.queue?.over ? ' ▲ intake closed' : ''}
          </span>
        ) },
        { head: 'Requires', cell: (l) => {
          const f = fileLeg(file, l.leg);
          return f.requires.length ? <ul className="chips">{f.requires.map((r) => <li key={r} className="chip"><Text value={r} /></li>)}</ul> : <span className="mut">—</span>;
        } },
        { head: 'Outputs', cell: (l) => {
          const f = fileLeg(file, l.leg);
          return f.outputs.length ? <Text mono value={f.outputs.join(', ')} /> : <span className="mut">—</span>;
        } },
        { head: 'Timeout', align: 'right', cell: (l) => seconds(fileLeg(file, l.leg).timeoutS) },
        { head: 'Max runs', align: 'right', cell: (l) => fileLeg(file, l.leg).maxRuns ?? '—' },
        { head: 'p50 wait', align: 'right', cell: (l) => seconds(l.window?.wait_p50_s) },
        { head: 'p50 run', align: 'right', cell: (l) => seconds(l.window?.run_p50_s) },
        { head: 'Runs', align: 'right', cell: (l) => l.window?.started ?? 0 },
        { head: 'Fail rate', align: 'right', cell: (l) => percent(l.window?.fail_rate) },
      ]}
    />
    </div>
  );
}
