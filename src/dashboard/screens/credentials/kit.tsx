// kit.tsx — what the read-only screens share (B-199, B-200, B-214, B-215): the one grants read
// the credential and governance screens draw from, a fingerprint drawn short with the whole of
// it one focus away, an actor (`owner:<fingerprint>`) as text, a list as chips, and the block
// that names the CLI commands changing what the screen shows. None of these is a control: no
// credential, policy, setting or tenant write admits a session (§11.4, §12.2).
import type { ReactNode } from 'react';
import { useRead, type Read } from '../../lib/reads';
import { Text, textOf } from '../../lib/Text';
import { CliLine } from '../../lib/ui';
import { COMMANDS, type CommandId } from './commands';
import type { GrantsAnswer } from './types';
import './readonly.css';

/** `GET /v1/owner/{repository}/grants` (`owner.grant.list`): the one read of the credential
 *  screens and of Governance's settings, bars and consents. */
export function useGrants(repository: string): Read<GrantsAnswer> {
  return useRead<GrantsAnswer>(`/v1/owner/${encodeURIComponent(repository)}/grants`);
}

/** A read's list, or none: a field an older server leaves out is an empty list, never a crash. */
export function listOf<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** A key's fingerprint: its first characters, the whole of it on focus or hover (it is a
 *  focusable element, so a keyboard reaches it) and for a screen reader. Text, never a link. */
export function Fingerprint({ value }: { value: unknown }) {
  const full = textOf(value);
  if (typeof value !== 'string' || full.length <= 22) return <Text mono value={value} />;
  return (
    <span className="fp mono" tabIndex={0} title={full} aria-label={full}>
      <span className="fp-short" aria-hidden="true">{full.slice(0, 18)}…</span>
      <span className="fp-full">{full}</span>
    </span>
  );
}

/** Who did it, as Baton recorded it: `owner:<fingerprint>`, `admin:<fingerprint>`, `admin:seed`. */
export function Actor({ value }: { value: unknown }) {
  if (typeof value !== 'string' || value === '') return <span className="mut">—</span>;
  const at = value.indexOf(':');
  if (at < 1) return <Fingerprint value={value} />;
  return <span className="actor"><Text value={value.slice(0, at)} />: <Fingerprint value={value.slice(at + 1)} /></span>;
}

/** A list of names — capabilities, tiers, hosts — as chips; "none" for an empty one. */
export function Chips({ values, none = 'none' }: { values: unknown; none?: ReactNode }) {
  const list = listOf<unknown>(values);
  if (list.length === 0) return <span className="mut">{none}</span>;
  return <span className="chips">{list.map((v, i) => <span className="chip" key={i}><Text mono value={v} /></span>)}</span>;
}

/** Yes or no as a word and a shape — never colour alone. */
export function YesNo({ value, yes = 'yes', no = 'no' }: { value: unknown; yes?: string; no?: string }) {
  return value ? <span className="yes">● {yes}</span> : <span className="mut">○ {no}</span>;
}

/** The commands that change what a read-only screen shows, each as text to copy, with whose
 *  key signs them. */
export function HowToChange({ ids, children }: { ids: readonly CommandId[]; children?: ReactNode }) {
  const roles = new Set(ids.map((id) => COMMANDS[id].role));
  const who = roles.size === 2 ? 'an owner’s or an administrator’s key, as each line says'
    : roles.has('owner') ? 'an owner’s key (-i <key>)' : 'an administrator’s key (-i <key>)';
  return (
    <aside className="how" aria-label="How to change this">
      <p className="how-head">Read-only here. Change it from a terminal, signed with {who}:</p>
      <ul className="how-lines">
        {ids.map((id) => <li key={id}><CliLine>{COMMANDS[id].line}</CliLine></li>)}
      </ul>
      {children}
    </aside>
  );
}

/** A kind the ticket lists and Baton does not hold yet: the plain fact, and what builds it. */
export function NotBuiltBand({ lead, by, children }: { lead: ReactNode; by: string; children?: ReactNode }) {
  return (
    <div className="band" role="note">
      <p><strong>{lead}</strong> (<span className="mono">{by}</span>).</p>
      {children}
    </div>
  );
}
