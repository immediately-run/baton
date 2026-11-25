// ConditionScreen.tsx — `/repositories/{r}/conditions/{condition}`, the Resolve page (B-219;
// BATON_SPEC §7.3 R-BTN-163): one condition from `condition.show` — its kind and type, the
// ticket and where it stands, the restarts drawn large, what waits on its ticket — and, for an
// interaction request, the session link Baton holds. It is the page a notification opens: it
// fits a phone, and signed out the shell draws sign-in in place and keeps this address.
//
// A restart is a control only through the registry and the read's `allowed`. No resolve is
// built (B-56), so the read allows none and the page says so; nothing here is a confirmed
// action (R-BTN-155). The shell's polling re-reads the condition, so the page says when it
// closed without being asked.
import type { ReactNode } from 'react';
import { Controls } from '../../app/controls/Controls';
import { ReadGate } from '../../app/Refusal';
import { Link, pathOrNull } from '../../app/router';
import { ExtLink } from '../../lib/links';
import { useRead } from '../../lib/reads';
import { Text, textOf } from '../../lib/Text';
import { Band, Empty, KeyValues, NotBuiltNote, PageHeader, RelTime, Section, UtcTime } from '../../lib/ui';
import type { ScreenProps } from '../contract';
import { KindMark, kindOf, Restarts, Severity, TicketLink } from './kit';
import type { ConditionShown } from './types';

function Body({ c, repository }: { c: ConditionShown; repository: string }) {
  const kind = kindOf(c);
  const open = c.outcome === 'open';
  const interact = textOf(c.type) === 'interact' || textOf(c.type).startsWith('interact.');
  const restarts = Object.keys(c.restarts ?? {}).length;
  const list = pathOrNull('repository/conditions', { repository });
  const unblocks = Array.isArray(c.unblocks) ? c.unblocks : [];
  const allowed = Array.isArray(c.allowed) ? c.allowed : [];
  const facts: [ReactNode, ReactNode][] = [
    ['type', <Text mono value={c.type} />],
    ['disposition', <Text mono value={c.disposition} />],
    ['severity', <Text value={c.severity} />],
    ['ticket', <TicketLink id={c.ticket_id} repository={repository} />],
    ['stands at', c.ticket?.station ? <><Text mono value={c.ticket.station} />{c.ticket.next_leg ? <> · next leg <Text mono value={c.ticket.next_leg} /></> : null}</> : <span className="mut">—</span>],
    ['raised by leg', <Text mono value={c.leg} />],
    ['raised', <><RelTime at={c.raised_at} /> · <UtcTime at={c.raised_at} /></>],
    ['outcome', <Text mono value={c.outcome} />],
  ];
  if (!interact && c.url) facts.push(['asked at', <ExtLink href={c.url} showHost />]);
  return (
    <>
      <PageHeader
        title={<span className="resolve-head"><KindMark kind={kind} type={c.type} /><Severity value={c.severity} /></span>}
        sub={<>Condition <Text mono value={c.condition_id} /> on <TicketLink id={c.ticket_id} repository={repository} />{c.ticket?.title ? <> — <Text value={c.ticket.title} /></> : null}</>}
      />
      {open ? null : (
        <Band>
          <p>
            This condition is closed{c.closed_at != null ? <> — <RelTime at={c.closed_at} /></> : null}: <Text mono value={c.outcome} />
            {c.closed_how ? <> (<Text mono value={c.closed_how} />)</> : null}. Nothing waits on it.
          </p>
        </Band>
      )}
      {interact && open ? (
        <Band tone="warn">
          <p>A leg asks a person into its session. {c.url ? <ExtLink href={c.url} kind="session" showHost /> : <span className="mut">Baton holds no link for it.</span>}</p>
        </Band>
      ) : null}
      <Section title="The condition">
        <KeyValues rows={facts} />
      </Section>
      <Section title="Restarts" count={restarts}>
        {restarts === 0
          ? <Empty>{interact ? 'An interaction request takes no restart: it closes when its run ends or raises again.' : 'This condition offers no restart.'}</Empty>
          : <div className="resolve-restarts"><Restarts condition={c} /></div>}
        <Controls
          view="repository/conditions/{condition}"
          allowed={allowed}
          label="Restarts"
          target={{ repository, ticket_id: c.ticket_id, condition_id: c.condition_id, condition: c.condition_id }}
        />
        {open && restarts > 0 && allowed.length === 0 ? <NotBuiltNote what="Resolving a condition by one of its restarts" ticket={c.not_built?.resolve ?? 'B-56'} /> : null}
      </Section>
      <Section title="Waiting on its ticket" count={unblocks.length} hint="Tickets blocked on this condition’s ticket.">
        {unblocks.length === 0
          ? <Empty>No ticket is blocked on it.</Empty>
          : <ul className="needs-restarts">{unblocks.map((id) => <li key={textOf(id)}><TicketLink id={id} repository={repository} /></li>)}</ul>}
      </Section>
      {list ? <p><Link to={list}>All conditions</Link></p> : null}
    </>
  );
}

export function ConditionScreen({ params }: ScreenProps) {
  const repository = params.repository;
  const read = useRead<ConditionShown>(`/v1/repositories/${encodeURIComponent(repository)}/conditions/${encodeURIComponent(params.condition)}`);
  const back = pathOrNull('repository/conditions', { repository });
  return (
    <ReadGate read={read} entity="condition" id={params.condition} back={back ? { to: back, label: 'Conditions' } : undefined}>
      {(c) => <Body c={c} repository={repository} />}
    </ReadGate>
  );
}
