// AttestationsScreen.tsx — `/repositories/{r}/attestations` (B-213; BATON_SPEC §12.8 R-BTN-181,
// R-BTN-185): the repository's typed statements with their writers, from `attestation.list`.
// R-BTN-181's store is not built (B-146): what Baton holds — and so what this draws — is each
// applied answer to a person leg, a `std:decision@1`; the page says so and invents no row.
// `?subject=`, `?type=` and `?live=1` are the URL's; the read's cursor pages it.
//
// Adding one is the registry's to offer and the read's to allow (`writable_types`): no entry
// lets a session write an attestation (an administrator is no owner, R-BTN-57; the owner's
// session is B-76), so the page names the CLI line and draws no form. A value is drawn through
// `View` — R-BTN-112's renderer where the type's schema has a view, else pretty-printed text —
// never as markup (§12.3).
import { Controls } from '../../app/controls/Controls';
import { ReadGate } from '../../app/Refusal';
import { navigate, useSearch } from '../../app/router';
import { useRead } from '../../lib/reads';
import { Text, textOf } from '../../lib/Text';
import { CliLine, NotBuiltNote, PageHeader, Pager, RelTime, Section, usePager } from '../../lib/ui';
import { View } from '../../lib/View';
import type { ScreenProps } from '../contract';
import { CardTable, queryOf, TicketLink, withQuery } from '../conditions/kit';

/** One attestation as `attestation.list` answers it (R-BTN-181's row shape). */
export interface Attestation {
  id: number | string;
  type: string;
  subject: { ticket?: string; commit?: string } | string | null;
  value: unknown;
  writer: { credential: string | null; class: string } | null;
  domain: string | null;
  at: number;
  lapses_at: number | null;
  revoked_at: number | null;
}

export interface AttestationList {
  attestations: Attestation[];
  next_cursor?: string;
  writable_types: string[];
  writable_why?: string | null;
  types?: string[];
  not_built?: Record<string, string>;
}

/** The word a row's state is drawn under: revoked, lapsed, or in force. */
export function stateOf(a: Pick<Attestation, 'lapses_at' | 'revoked_at'>, now: number): 'revoked' | 'lapsed' | 'in force' {
  if (a.revoked_at != null) return 'revoked';
  if (a.lapses_at != null && a.lapses_at <= now) return 'lapsed';
  return 'in force';
}

function Subject({ subject, repository }: { subject: Attestation['subject']; repository: string }) {
  if (subject && typeof subject === 'object') {
    if (typeof subject.ticket === 'string') return <TicketLink id={subject.ticket} repository={repository} />;
    if (typeof subject.commit === 'string') return <Text mono value={subject.commit} />;
  }
  return <Text mono value={subject} />;
}

export function AttestationsScreen({ params }: ScreenProps) {
  const repository = params.repository;
  const search = useSearch();
  const query = queryOf(search);
  const subject = query.get('subject') ?? '';
  const type = query.get('type') ?? '';
  const live = query.get('live') === '1';
  const pager = usePager();
  const set = (changes: Record<string, string | null>) => {
    pager.first();
    navigate(withQuery(search, changes), { replace: true });
  };
  const q = new URLSearchParams();
  if (subject) q.set('subject', subject);
  if (type) q.set('type', type);
  if (live) q.set('live', '1');
  if (pager.after) q.set('cursor', pager.after);
  const text = q.toString();
  const read = useRead<AttestationList>(`/v1/repositories/${encodeURIComponent(repository)}/attestations${text ? `?${text}` : ''}`);
  const now = Date.now();
  return (
    <>
      <PageHeader title="Attestations" sub="What Baton was told about this repository’s tickets, and by whom." />
      <form className="filters" onSubmit={(e) => e.preventDefault()}>
        <label>Subject <input className="input" type="search" aria-label="Subject" placeholder="a ticket id" value={subject} onChange={(e) => set({ subject: e.target.value.trim() })} /></label>
        <label>Type <input className="input" type="search" aria-label="Attestation type" placeholder="std:decision@1" value={type} onChange={(e) => set({ type: e.target.value.trim() })} /></label>
        <label><input type="checkbox" checked={live} onChange={(e) => set({ live: e.target.checked ? '1' : null })} /> In force only</label>
      </form>
      <ReadGate read={read} entity="repository" id={repository}>
        {(data) => {
          const rows = Array.isArray(data.attestations) ? data.attestations : [];
          const writable = Array.isArray(data.writable_types) ? data.writable_types : [];
          const held = Array.isArray(data.types) ? data.types : [];
          return (
            <>
              <Section title="Attestations" count={rows.length} hint="Newest first.">
                <CardTable
                  label="Attestations of the repository"
                  empty="No attestation matches."
                  rows={rows}
                  rowKey={(a, i) => `${textOf(a.id)} ${i}`}
                  rowClass={(a) => (stateOf(a, now) === 'in force' ? undefined : 'row-lapsed')}
                  columns={[
                    { head: 'Type', rowHeader: true, cell: (a) => <Text mono value={a.type} /> },
                    { head: 'Subject', cell: (a) => <Subject subject={a.subject} repository={repository} /> },
                    { head: 'Value', cell: (a) => (
                      <div className="value-cell">
                        <details>
                          <summary>Show</summary>
                          <View value={a.value} schema={a.type} repository={repository} />
                        </details>
                      </div>
                    ) },
                    { head: 'Writer', cell: (a) => (a.writer ? <><Text value={a.writer.class} />{a.writer.credential ? <> · <Text mono value={a.writer.credential} /></> : null}</> : <span className="mut">—</span>) },
                    { head: 'Domain', cell: (a) => (a.domain ? <Text mono value={a.domain} /> : <span className="mut">—</span>) },
                    { head: 'At', cell: (a) => <RelTime at={a.at} /> },
                    { head: 'Lapses', cell: (a) => (a.lapses_at != null ? <RelTime at={a.lapses_at} /> : <span className="mut">never</span>) },
                    { head: 'State', cell: (a) => <Text value={stateOf(a, now)} /> },
                  ]}
                />
                <Pager pager={pager} next={data.next_cursor} />
                {held.length > 0 ? (
                  <p className="mut">
                    Baton holds {held.map((t, i) => <span key={textOf(t)}>{i ? ', ' : ''}<Text mono value={t} /></span>)} here: each applied answer to a person’s leg.
                  </p>
                ) : null}
                {data.not_built?.store ? <NotBuiltNote what="The store of every other attestation type, with lapses and revocation" ticket={data.not_built.store} /> : null}
              </Section>
              <Section title="Add attestation">
                {/* Drawn from the registry, and only for a type the read says this caller may
                    write. No entry lists a session today, so none is drawn. */}
                <Controls view="repository/attestations" allowed={writable.length > 0 ? ['attestation.add'] : []} target={{ repository }} />
                {writable.length > 0
                  ? <p>Your key may write {writable.map((t, i) => <span key={textOf(t)}>{i ? ', ' : ''}<Text mono value={t} /></span>)}.</p>
                  : <p className="mut">This page writes no attestation{data.writable_why ? <> — <Text value={data.writable_why} /></> : null}.</p>}
                <p>A person’s answer is written where an owner key or a human-only key is:</p>
                <p className="needs-line"><CliLine>baton decision answer -i KEY <Text value={repository} />:&lt;ticket&gt; &lt;option&gt;</CliLine></p>
              </Section>
            </>
          );
        }}
      </ReadGate>
    </>
  );
}
