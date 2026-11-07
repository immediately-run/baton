// signed-control.test.ts — B-127's client half, unit level (Node only: it runs git and
// ssh-keygen for real): the SSHSIG commit verifier (src/shared/commitSign.mjs) and the walks
// that decide what counts (src/defaults/signed-control.ts) — the groups a runner loads from,
// the notice's unsigned paths, the brief marks and the EXPEDITE gate, first parents only, so a
// crafted merge cannot roll a control input back to an older signed version (finding 13).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { allowedSigners, commitSignature, signedPayload, verifySignedCommit, nodeKeygen } from '../../src/shared/commitSign.mjs';
import { briefOf, isAgentConfigPath, isSignedControlPath, marksOf, signedControlOf, unsignedAgentConfig, type SigningKey } from '../../src/defaults/signed-control';

/** One real key pair on disk, as an owner's hardware key stands in test: `-S` signs with the file. */
function keypair(dir: string, name: string): { pub: string; file: string; key: SigningKey } {
  const file = join(dir, name);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', file, '-C', `${name}@test`], { stdio: 'ignore' });
  const pub = readFileSync(`${file}.pub`, 'utf8').trim();
  const fingerprint = /(\bSHA256:[A-Za-z0-9+/]{43}\b)/.exec(execFileSync('ssh-keygen', ['-lf', `${file}.pub`], { encoding: 'utf8' }))![1];
  return { pub, file, key: { public_key: pub, fingerprint } };
}

let dir: string;
let owner: { pub: string; file: string; key: SigningKey };
let other: { pub: string; file: string; key: SigningKey };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'baton-b127-unit-'));
  owner = keypair(dir, 'owner');
  other = keypair(dir, 'other');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface Repo {
  dir: string;
  g: (...a: string[]) => string;
  write(path: string, text: string): void;
  commit(o?: { sign?: 'owner' | 'other'; message?: string }): string;
  head(): string;
}

/** A real repository whose commits sign (or not) as told, first-parent history as the walk reads. */
function repo(): Repo {
  const r = mkdtempSync(join(tmpdir(), 'baton-b127-repo-'));
  const g = (...a: string[]) => execFileSync('git', ['-C', r, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'b127@test');
  g('config', 'user.name', 'b127 test');
  return {
    dir: r,
    g,
    write(path: string, text: string): void {
      mkdirSync(dirname(join(r, path)), { recursive: true });
      writeFileSync(join(r, path), text);
      g('add', path);
    },
    commit({ sign, message = 'change' }: { sign?: 'owner' | 'other'; message?: string } = {}): string {
      const key = sign ? ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${sign === 'owner' ? owner.file : other.file}`] : [];
      g(...key, 'commit', ...(sign ? ['-S'] : ['--no-gpg-sign']), '-m', message);
      return this.head();
    },
    head(): string {
      return g('rev-parse', 'HEAD');
    },
  };
}

describe('commitSign (B-127): an owner-signed git commit, verified', () => {
  it('extracts the SSHSIG and strips it from the payload git signed', () => {
    const r = repo();
    r.write('.baton/baton.json', '{}\n');
    const sha = r.commit({ sign: 'owner' });
    const raw = execFileSync('git', ['-C', r.dir, 'cat-file', 'commit', sha], { encoding: 'utf8' });
    expect(commitSignature(raw)).toMatch(/^-----BEGIN SSH SIGNATURE-----/);
    expect(signedPayload(raw)).not.toContain('SSH SIGNATURE');
    expect(signedPayload(raw)).toContain('b127@test');
    rmSync(r.dir, { recursive: true, force: true });
  });

  it('allowedSigners writes the principal and the namespace, public lines only', () => {
    expect(allowedSigners([owner.pub])).toBe(`baton-owner namespaces="git" ${owner.pub}\n`);
    expect(allowedSigners(['not a key'])).toBe('');
  });

  it('verifies the owner key, refuses another key, a forged signature and an unsigned commit', () => {
    const r = repo();
    r.write('.baton/baton.json', '{"v":1}\n');
    const signedRaw = execFileSync('git', ['-C', r.dir, 'cat-file', 'commit', r.commit({ sign: 'owner' })], { encoding: 'utf8' });
    r.write('.baton/baton.json', '{"v":2}\n');
    const unsignedRaw = execFileSync('git', ['-C', r.dir, 'cat-file', 'commit', r.commit({})], { encoding: 'utf8' });
    expect(verifySignedCommit(signedRaw, [owner.pub], nodeKeygen)).toMatchObject({ key: owner.key.fingerprint });
    expect(verifySignedCommit(signedRaw, [other.pub], nodeKeygen)).toBeNull();
    // A forged signature: the unsigned commit's object with the signed one's armor — a
    // signature that did not sign what it is presented over.
    const armorOf = (raw: string): string[] => {
      const ls = raw.split('\n');
      const at = ls.findIndex((l) => l.startsWith('gpgsig '));
      let end = at + 1;
      while (ls[end]?.startsWith(' ')) end++;
      return ls.slice(at, end);
    };
    const unsignedLines = unsignedRaw.split('\n');
    const messageAt = unsignedLines.findIndex((l) => l === '');
    const forged = [...unsignedLines.slice(0, messageAt), ...armorOf(signedRaw), ...unsignedLines.slice(messageAt)].join('\n');
    expect(commitSignature(forged)).toMatch(/^-----BEGIN SSH SIGNATURE-----/);
    expect(verifySignedCommit(forged, [owner.pub], nodeKeygen)).toBeNull();
    expect(verifySignedCommit(unsignedRaw, [owner.pub], nodeKeygen)).toBeNull();
    expect(verifySignedCommit(signedRaw, [], nodeKeygen)).toBeNull();
    rmSync(r.dir, { recursive: true, force: true });
  });
});

describe('signedControlOf (B-127): what counts, first parents only', () => {
  const gitOf = (r: Repo) => (...a: string[]): string => execFileSync('git', ['-C', r.dir, ...a], { encoding: 'utf8' });

  it('an unsigned change keeps the last owner-signed version in force and is listed', () => {
    const r = repo();
    r.write('.baton/baton.json', '{"agent_command":"signed one"}\n');
    const signedSha = r.commit({ sign: 'owner' });
    r.write('.baton/baton.json', '{"agent_command":"pushed by the worker"}\n');
    const unsignedSha = r.commit({});
    const sc = signedControlOf(unsignedSha, [owner.key], gitOf(r), nodeKeygen)!;
    expect(sc.groups.agent_command).toMatchObject({ read: signedSha, key: owner.key.fingerprint });
    expect(sc.groups.agent_command.unsigned).toEqual([unsignedSha]);
    expect(sc.unsigned).toContainEqual({ path: '.baton/baton.json', commits: [unsignedSha] });
    rmSync(r.dir, { recursive: true, force: true });
  });

  it('an owner-signed change takes effect; a non-owner key counts as unsigned; no signed version fails closed', () => {
    const r = repo();
    r.write('.baton/baton.json', '{"v":1}\n');
    const first = r.commit({});
    const scNone = signedControlOf(first, [owner.key], gitOf(r), nodeKeygen)!;
    expect(scNone.groups.agent_command.read).toBeNull();
    r.write('.baton/baton.json', '{"v":2}\n');
    const otherKey = r.commit({ sign: 'other' });
    const scOther = signedControlOf(otherKey, [owner.key], gitOf(r), nodeKeygen)!;
    expect(scOther.groups.agent_command.read).toBeNull();
    expect(scOther.groups.agent_command.unsigned).toEqual([otherKey, first]);
    r.write('.baton/baton.json', '{"v":3}\n');
    const signed = r.commit({ sign: 'owner' });
    expect(signedControlOf(signed, [owner.key], gitOf(r), nodeKeygen)!.groups.agent_command).toMatchObject({ read: signed, key: owner.key.fingerprint });
    rmSync(r.dir, { recursive: true, force: true });
  });

  it('a merge restoring an older signed version is that merge\'s change, never a rollback (finding 13)', () => {
    const r = repo();
    const v1 = '{"agent_command":"v1, signed"}\n';
    r.write('.baton/baton.json', v1);
    r.commit({ sign: 'owner' });
    r.write('.baton/baton.json', '{"agent_command":"v2, signed"}\n');
    const v2 = r.commit({ sign: 'owner' });
    // A side branch changes the file unsigned; the merge then resolves it back to v1's exact
    // bytes — content a signed commit once wrote — and lands unsigned.
    r.g('checkout', '-q', '-b', 'side', 'HEAD~1');
    r.write('.baton/baton.json', '{"agent_command":"v1, changed on the side"}\n');
    r.commit({});
    r.g('checkout', '-q', 'main');
    try {
      r.g('merge', '--no-commit', '--no-ff', 'side');
    } catch {
      // The conflict is the point: the resolution below is the attack.
    }
    writeFileSync(join(r.dir, '.baton/baton.json'), v1);
    r.g('add', '.baton/baton.json');
    r.g('commit', '--no-gpg-sign', '-m', 'merge the rollback');
    const head = r.head();
    // The head's file is byte-identical to the older signed v1: a content check would pass.
    expect(execFileSync('git', ['-C', r.dir, 'show', `${head}:.baton/baton.json`], { encoding: 'utf8' })).toBe(v1);
    const sc = signedControlOf(head, [owner.key], gitOf(r), nodeKeygen)!;
    // The merge is the last change of the group (its tree differs from its first parent on the
    // path) and it is unsigned, so the last signed version — v2 — stays in force: the crafted
    // rollback to v1 never counts.
    expect(sc.groups.agent_command.read).toBe(v2);
    expect(sc.groups.agent_command.unsigned).toEqual([head]);
    rmSync(r.dir, { recursive: true, force: true });
  });

  it('the notice\'s paths are the control inputs: .baton, goals, agent configuration; a ticket file only for its EXPEDITE', () => {
    expect(isSignedControlPath('.baton/baton.json')).toBe(true);
    expect(isSignedControlPath('goals/2027.mdx')).toBe(true);
    expect(isSignedControlPath('.claude/settings.json')).toBe(true);
    expect(isSignedControlPath('docs/guide/CLAUDE.md')).toBe(true);
    expect(isSignedControlPath('src/core/baton.ts')).toBe(false);
    expect(isAgentConfigPath('.claude/hooks/run.sh')).toBe(true);
    expect(isAgentConfigPath('.baton/baton.json')).toBe(false);
  });

  it('the agent-configuration verifier names the paths an unsigned commit last changed', () => {
    const r = repo();
    r.write('.claude/settings.json', '{"hooks":{}}\n');
    const signed = r.commit({ sign: 'owner' });
    expect(unsignedAgentConfig(signed, [owner.key], gitOf(r), nodeKeygen)).toEqual([]);
    r.write('.claude/hooks/session-context.sh', '#!/bin/sh\n');
    const unsigned = r.commit({});
    expect(unsignedAgentConfig(unsigned, [owner.key], gitOf(r), nodeKeygen)).toEqual([
      { path: '.claude/hooks/session-context.sh', commit: unsigned },
    ]);
    rmSync(r.dir, { recursive: true, force: true });
  });
});

describe('marksOf (B-127 item 7): brief marks and the EXPEDITE gate', () => {
  const gitOf = (r: Repo) => (...a: string[]): string => execFileSync('git', ['-C', r.dir, ...a], { encoding: 'utf8' });
  const TICKET = 'tickets/B-1.mdx';
  const body = (brief: string, tags: string[] = [], tail = ''): string =>
    `---\nid: B-1\ntitle: One${tags.length ? `\ntags: [${tags.join(', ')}]` : ''}\n---\n\n${brief ? `**Brief:** ${brief}\n` : ''}Body.\n${tail}\n\n## Status\n`;

  it('a brief added in an owner-signed commit is signed; the same text pushed unsigned is unsigned; editing it unsigned makes it unsigned', () => {
    const r = repo();
    r.write(TICKET, body('the owner, 2026-10-27: do the thing.'));
    const filed = r.commit({ sign: 'owner' });
    let marks = marksOf(filed, [owner.key], [TICKET], gitOf(r), nodeKeygen);
    expect(marks.briefs.get(TICKET)).toMatchObject({ signed: true, signer: owner.key.fingerprint, commit: filed });
    // The same brief text, its words carried back into the repository by an unsigned push: the
    // file withdrawn and re-filed with bytes identical where it matters.
    r.g('rm', '-q', TICKET);
    r.commit({});
    r.write(TICKET, body('the owner, 2026-10-27: do the thing.'));
    const pushed = r.commit({});
    marks = marksOf(pushed, [owner.key], [TICKET], gitOf(r), nodeKeygen);
    expect(marks.briefs.get(TICKET)).toMatchObject({ signed: false, commit: pushed });
    // A signed brief edited in an unsigned commit.
    r.write(TICKET, body('the owner, 2026-10-27: do the OTHER thing.'));
    const edited = r.commit({});
    marks = marksOf(edited, [owner.key], [TICKET], gitOf(r), nodeKeygen);
    expect(marks.briefs.get(TICKET)).toMatchObject({ signed: false, commit: edited });
    rmSync(r.dir, { recursive: true, force: true });
  });

  it('a Status line appended unsigned does not touch the brief\'s mark', () => {
    const r = repo();
    r.write(TICKET, body('the owner, 2026-10-27: do the thing.'));
    const filed = r.commit({ sign: 'owner' });
    r.write(TICKET, `${body('the owner, 2026-10-27: do the thing.')}- 2026-11-06 implement abc123: did a leg\n`);
    const appended = r.commit({});
    const marks = marksOf(appended, [owner.key], [TICKET], gitOf(r), nodeKeygen);
    expect(marks.briefs.get(TICKET)).toMatchObject({ signed: true, commit: filed });
    rmSync(r.dir, { recursive: true, force: true });
  });

  it('an EXPEDITE added unsigned does not count; one the owner signed does', () => {
    const r = repo();
    r.write(TICKET, body('a brief'));
    const filed = r.commit({});
    let marks = marksOf(filed, [owner.key], [TICKET], gitOf(r), nodeKeygen);
    expect(marks.expedite.has(TICKET)).toBe(false);
    // The tag added by an unsigned push.
    r.write(TICKET, body('a brief', ['EXPEDITE']));
    const pushed = r.commit({});
    marks = marksOf(pushed, [owner.key], [TICKET], gitOf(r), nodeKeygen);
    expect(marks.expedite.get(TICKET)).toBe(pushed);
    // The owner taking it over: the tag's last change must itself be signed — removing and
    // re-adding it in owner-signed commits — not merely a signed commit that left it standing.
    r.write(TICKET, body('a brief'));
    r.commit({ sign: 'owner' });
    r.write(TICKET, body('a brief', ['EXPEDITE']));
    const signed = r.commit({ sign: 'owner' });
    marks = marksOf(signed, [owner.key], [TICKET], gitOf(r), nodeKeygen);
    expect(marks.expedite.has(TICKET)).toBe(false);
    rmSync(r.dir, { recursive: true, force: true });
  });

  it('briefOf reads the Brief paragraph and nothing after it', () => {
    expect(briefOf('**Brief:** the owner: x\nmore of it\n\nbody')).toBe('**Brief:** the owner: x\nmore of it');
    expect(briefOf('no brief here')).toBeNull();
  });
});
