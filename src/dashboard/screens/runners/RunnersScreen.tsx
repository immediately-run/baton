// RunnersScreen.tsx — `/repositories/{r}/runners` (B-211 item 1): the fleet granted on the
// repository, from `repo.runners` alone — one card per runner, grouped by hostname as R-BTN-3
// says (Decision 9a), each host's cards in state order: working, silent, idle, dead.
import { ReadGate } from '../../app/Refusal';
import { useRead } from '../../lib/reads';
import { Text } from '../../lib/Text';
import { Empty, PageHeader, Section } from '../../lib/ui';
import type { ScreenProps } from '../contract';
import { RunnerCard, STATE_ORDER, stateOf } from './RunnerCard';
import type { RunnerRow, RunnersAnswer } from './types';
import './runners.css';

/** The rows by hostname, hosts in the read's order, each host's rows by state then name. */
export function groupByHost(rows: readonly RunnerRow[], now: number): { hostname: string; rows: RunnerRow[] }[] {
  const hosts = new Map<string, RunnerRow[]>();
  for (const r of rows) hosts.set(r.hostname, [...(hosts.get(r.hostname) ?? []), r]);
  const rank = (r: RunnerRow) => STATE_ORDER.indexOf(stateOf(r, now));
  return [...hosts].map(([hostname, list]) => ({ hostname, rows: [...list].sort((a, b) => rank(a) - rank(b)) }));
}

export function RunnersScreen({ params }: ScreenProps) {
  const repository = params.repository;
  const read = useRead<RunnersAnswer>(`/v1/repositories/${encodeURIComponent(repository)}/runners`);
  return (
    <>
      <PageHeader title="Runners" sub="The runners granted on this repository: alive or not, the claim each holds here and what it is doing." />
      <ReadGate read={read} entity="repository" id={repository}>
        {(data) => {
          const rows = Array.isArray(data.runners) ? data.runners : [];
          const now = typeof data.server_time === 'number' ? data.server_time : Date.now();
          const alive = rows.filter((r) => r.alive).length;
          if (rows.length === 0) return <Empty>No runner is granted on this repository. A runner appears here once its key holds a grant and it has sent a heartbeat.</Empty>;
          return (
            <>
              <p className="runners-sum">{alive} alive of {rows.length}</p>
              {groupByHost(rows, now).map((host) => (
                <Section key={host.hostname} title={<Text mono value={host.hostname} />} count={host.rows.length}>
                  <div className="runner-cards">
                    {host.rows.map((row) => <RunnerCard key={row.runner_id} repository={repository} row={row} now={now} notBuilt={data.not_built} />)}
                  </div>
                </Section>
              ))}
            </>
          );
        }}
      </ReadGate>
    </>
  );
}
