// RunnerScreen.tsx — `/repositories/{r}/runners/{runner}` (B-211 item 2): the runner's card, its
// profile, the earlier attempts on its live ticket's leg, and its window as a timeline with the
// same rows as a table. `?since=` in the URL is the window (`24h` unless given, `7d` at most).
import { ReadGate } from '../../app/Refusal';
import { Link, navigate, pathOf, pathOrNull, useSearch } from '../../app/router';
import { useRead } from '../../lib/reads';
import { Text } from '../../lib/Text';
import { JsonText } from '../../lib/View';
import { PageHeader, Section, Table, UtcTime } from '../../lib/ui';
import type { ScreenProps } from '../contract';
import { RunnerCard } from './RunnerCard';
import { Timeline } from './Timeline';
import { sinceOf, SPANS, windowWords, type RunnerAnswer } from './types';
import './runners.css';

/** The window's choices: links that put `?since=` in the URL, so a reload keeps the window. */
export function WindowPicker({ path, since }: { path: string; since: string | null }) {
  const current = since ?? SPANS[0];
  const all = (SPANS as readonly string[]).includes(current) ? SPANS : [...SPANS, current];
  return (
    <nav className="window-picker" aria-label="Window">
      <span className="mut">window</span>
      {all.map((s) => (
        <a key={s} href={`${path}?since=${s}`} aria-current={s === current ? 'true' : undefined} className={s === current ? 'on' : undefined}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            navigate(`${path}?since=${s}`, { replace: true });
          }}>{s.replace(/([hd])$/, ' $1')}</a>
      ))}
    </nav>
  );
}

export function RunnerScreen({ params }: ScreenProps) {
  const repository = params.repository;
  const since = sinceOf(useSearch());
  const read = useRead<RunnerAnswer>(`/v1/repositories/${encodeURIComponent(repository)}/runners/${encodeURIComponent(params.runner)}${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  const list = pathOf('repository/runners', { repository });
  const here = pathOrNull('repository/runners/{runner}', { repository, runner: params.runner }) ?? list;
  return (
    <ReadGate read={read} entity="runner" id={params.runner} back={{ to: list, label: 'Runners' }}>
      {(data) => {
        const now = typeof data.server_time === 'number' ? data.server_time : Date.now();
        const row = data.runner;
        return (
          <>
            <PageHeader title={<><Text value={row.hostname} /> / <Text value={row.session_name} /></>} sub={<>Runner <Text mono value={row.runner_id} /> · <Link to={list}>all runners</Link></>}>
              <WindowPicker path={here} since={since} />
            </PageHeader>
            <div className="runner-one">
              <RunnerCard repository={repository} row={row} now={now} heading={<>Runner <Text mono value={row.runner_id} /></>} notBuilt={data.not_built} />
            </div>
            <Section title="Timeline" hint={<>the last {windowWords(data.window.until - data.window.since)} · claims as bars, activities nested</>}>
              <Timeline repository={repository} window={data.window} notBuilt={data.not_built} />
            </Section>
            <Section title="Earlier attempts" count={data.attempts.length} hint="on its live ticket’s leg">
              <Table
                label="Earlier attempts on the live ticket’s leg"
                rows={data.attempts}
                rowKey={(a) => `${a.claim_id}:${a.run}`}
                empty={row.claim ? 'This is the first run of the leg on its ticket.' : 'It holds no claim here.'}
                columns={[
                  { head: 'Run', rowHeader: true, cell: (a) => <Text mono value={a.run} /> },
                  { head: 'Run id', cell: (a) => <Text mono value={a.run_id} /> },
                  { head: 'Runner', cell: (a) => {
                    const to = pathOrNull('repository/runners/{runner}', { repository, runner: String(a.runner_id) });
                    return to ? <Link to={to}><Text mono value={a.runner_id} /></Link> : <Text mono value={a.runner_id} />;
                  } },
                  { head: 'Started', cell: (a) => <UtcTime at={a.started_at} /> },
                  { head: 'Ended', cell: (a) => <UtcTime at={a.ended_at} /> },
                  { head: 'End', cell: (a) => <Text mono value={a.end} /> },
                  { head: 'Detail', cell: (a) => <Text value={a.detail} /> },
                ]}
              />
            </Section>
            <Section title="Profile" hint="the runner’s own statement, as it sent it">
              {row.profile != null ? <JsonText value={row.profile} /> : <p className="empty">It has sent no profile.</p>}
            </Section>
          </>
        );
      }}
    </ReadGate>
  );
}
