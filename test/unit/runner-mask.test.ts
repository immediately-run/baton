// S-BTN-98 and S-BTN-119's pure half (B-170; BATON_SPEC §8.4 R-BTN-144, class 7). Class 7 is the
// value of every variable whose name ends `_KEY`, `_TOKEN`, `_SECRET`, `_PASSWORD` or `_PAT`, or is
// `PGPASSWORD`, and of every name `runner.json` `mask_env` lists: this file tests the names, the
// values they stand for, the masking of one string, the stream sink a leg's output goes through
// line by line, and where `runner.json` is read from. The runner's own half — which environment it
// masks, the wiring of the sink and of the failure texts a leg leaves — is in runner-main.test.ts.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FAILURE_DETAIL_MAX, MIN_SECRET_BYTES, SECRET_NAME_EXACT, SECRET_NAME_SUFFIXES, createLegMasker, failureDetail, holdLiteralTail,
  maskLegOutput, namesASecret, readMaskEnv, runnerConfigPath, secretValues, underBatonDirectory,
} from '../../src/runner/mask';

const KEY = 'sk-ant-api03-AbCdEfGhIjKlMn';
const PAT = 'github_pat_11ABCDEFG0123456789';

describe('class 7 by name (R-BTN-144; S-BTN-98, redaction slice)', () => {
  it('the five endings and PGPASSWORD, exactly as the environment spells them — case-sensitive', () => {
    expect(SECRET_NAME_SUFFIXES).toEqual(['_KEY', '_TOKEN', '_SECRET', '_PASSWORD', '_PAT']);
    expect(SECRET_NAME_EXACT).toBe('PGPASSWORD');
    for (const name of ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'DB_PASSWORD', 'GH_PAT', 'PGPASSWORD']) expect(namesASecret(name)).toBe(true);
    // A name that only resembles one is not masked: the comparison is exact and case-sensitive.
    for (const name of ['api_key', 'Secret', 'TOKEN', 'PGPASSWORD_OLD', 'KEY', 'PASSWORD', 'PATH']) expect(namesASecret(name)).toBe(false);
  });

  it('the values are those of names that say so, and those mask_env names, of 8 bytes or more, each once', () => {
    const env = {
      ANTHROPIC_API_KEY: KEY, GITHUB_TOKEN: PAT, api_key: 'lower-case-not-masked', PGPASSWORD: 'hunter2hunter2',
      VENDOR_THING: 'a-value-in-mask_env', TOO_SHORT_SECRET: 'short', PATH: '/usr/bin',
    };
    expect(secretValues(env, ['VENDOR_THING'])).toEqual([KEY, PAT, 'hunter2hunter2', 'a-value-in-mask_env']);
    // Two variables holding one value are one literal; a mask_env name is taken as written.
    expect(secretValues({ A_KEY: 'same-value-1', B_TOKEN: 'same-value-1' })).toEqual(['same-value-1']);
    expect(secretValues(env, ['VENDOR_THING', 'PATH'])).toContain('/usr/bin');
    expect(MIN_SECRET_BYTES).toBe(8);
  });

  it('maskLegOutput masks class 7 wherever it occurs, and classes 5 and 6 with it', () => {
    const secrets = secretValues({ ANTHROPIC_API_KEY: KEY });
    expect(maskLegOutput(`key is ${KEY}, twice ${KEY}`, secrets)).toBe('key is ***, twice ***');
    expect(maskLegOutput('Authorization: Bearer bmr_abc123DEF and bps_xyz-1', secrets)).toBe('Authorization: Bearer *** and ***');
    expect(maskLegOutput('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----', secrets)).toBe('***\n***\n***');
  });

  it('a secret holding a replacement pattern\'s own characters (`$&`) is masked as it stands', () => {
    expect(maskLegOutput('the password is pa$$w0rd$&x$1y.', ['pa$$w0rd$&x$1y'])).toBe('the password is ***.');
  });

  it('the literal hold keeps the longest tail that could start a literal, and nothing shorter', () => {
    expect(holdLiteralTail('prefix sk-ant', [KEY])).toEqual({ head: 'prefix ', tail: 'sk-ant' });
    expect(holdLiteralTail('prefix s', [KEY])).toEqual({ head: 'prefix ', tail: 's' });
    expect(holdLiteralTail('prefix x', [KEY])).toEqual({ head: 'prefix x', tail: '' });
    expect(holdLiteralTail(`start ${KEY} tail`, [KEY])).toEqual({ head: `start ${KEY} tail`, tail: '' });
    // Two literals sharing a first character (round 1, finding 2): the hold is the longest tail
    // one extends — 'abraca', which 'abracaZZZZ' is still completing — never the one character
    // that also prefixes 'alpha2024xyz', or the completing line leaks the key byte by byte.
    expect(holdLiteralTail('xx abraca', ['abracaZZZZ', 'alpha2024xyz'])).toEqual({ head: 'xx ', tail: 'abraca' });
    // The whole text can be the hold, when a literal is still longer than all of it.
    expect(holdLiteralTail(KEY, [`${KEY}extra`])).toEqual({ head: '', tail: KEY });
  });

  it('a secret split across two lines is masked as one: the held tail leaves unlogged until the line that completes it', () => {
    const sink = createLegMasker([KEY]);
    // Round 1, finding 1: the tail the sink holds is not emitted — neither as its own line nor
    // inside the head — so no prefix of the key reaches the log in clear.
    expect(sink.push(`prefix ${KEY.slice(0, -1)}`)).toBe('prefix ');
    expect(sink.push(`${KEY.slice(-1)} done`)).toBe('*** done');
    // A whole literal on one line, and a second split after it, still as one.
    expect(sink.push(`key ${KEY}`)).toBe('key ***');
    expect(sink.push(`first ${KEY.slice(0, 12)}`)).toBe('first ');
    expect(sink.push(`${KEY.slice(12)} then`)).toBe('*** then');
    expect(sink.flush()).toBe('');
  });

  it('a stream that ends on a held partial flushes ***, never the partial itself', () => {
    const sink = createLegMasker([KEY]);
    expect(sink.push(`prefix ${KEY.slice(0, 15)}`)).toBe('prefix ');
    // The stream is over: the partial may be the key's own bytes, so it leaves masked.
    expect(sink.flush()).toBe('***');
    // And a partial the next line disproves leaves masked too — never verbatim.
    const other = createLegMasker([KEY]);
    expect(other.push(`end ${KEY.slice(0, 12)}`)).toBe('end ');
    expect(other.push('unrelated text')).toBe('***\nunrelated text');
    expect(other.flush()).toBe('');
  });

  it('a value holding a newline is masked across the boundary the line framing ate', () => {
    const value = 'topsecret\nsecondline';
    const sink = createLegMasker([value]);
    // Round 1, should-fix 5: the two halves re-form with the newline restored.
    expect(sink.push('v=topsecret')).toBe('v=');
    expect(sink.push('secondline')).toBe('***');
    expect(sink.push('x topsecret')).toBe('x ');
    expect(sink.push(`secondline y`)).toBe('*** y');
    // A value whose own last character is a newline is masked where it stands. The trailing
    // `e` of "here" prefixes the literal, so it is held — a hold the stream's end leaves `***`.
    const trailing = createLegMasker(['endswithnewline\n']);
    expect(trailing.push('token endswithnewline here')).toBe('token *** her');
    expect(trailing.flush()).toBe('***');
  });

  it('S-BTN-119: a whole literal whose last bytes start another literal is masked whole, never cut by the hold', () => {
    // The flaky run of 2026-11-22: the tests' runner ran inside a leg whose environment held a
    // value starting with the last byte of the one printed, so the hold cut inside the printed
    // literal and its head left in clear (`vendor: vendor-credential-9f2c7`, `whole key: sk-…`).
    const vendor = 'vendor-credential-9f2c71';
    const other = '1abcdef0123456';
    const sink = createLegMasker([vendor, other]);
    expect(sink.push(`vendor: ${vendor}`)).toBe('vendor: ***');
    // The held `1` was the masked literal's own byte: a line that does not complete `other`
    // leaves as it is, with no stray `***` of its own.
    expect(sink.push('next line')).toBe('next line');
    // Held across a key's tail that starts another, at the stream's end: nothing left in clear.
    expect(sink.push(`whole: ${vendor}`)).toBe('whole: ***');
    expect(sink.flush()).toBe('');
    // And when the next line does complete the overlapping literal, it is masked too — neither
    // value's bytes reach the log.
    const both = createLegMasker([vendor, other]);
    expect(both.push(`v ${vendor}`)).toBe('v ***');
    expect(both.push(`${other.slice(1)} after`)).toBe('*** after');
    // Several bytes of overlap, the key masked whole on its line in either order of the set.
    for (const set of [[KEY, 'lMnZZZZZZZ'], ['lMnZZZZZZZ', KEY]]) {
      const s = createLegMasker(set);
      const said = [s.push(`whole key: ${KEY}`), s.push('token: x'), s.flush()].join('\n');
      expect(said).toBe('whole key: ***\ntoken: x\n');
      expect(said).not.toContain(KEY.slice(0, 14));
    }
  });

  it('S-BTN-119: held bytes that already left as *** never leave again — whatever the next line completes or opens', () => {
    const run = (set: string[], lines: string[]) => {
      const sink = createLegMasker(set);
      return [...lines.map((l) => sink.push(l)), sink.flush()].join('\n');
    };
    const vendor = 'vendor-credential-9f2c71';
    // The next line completes a literal: the held bytes (the first one's last) are not put back.
    expect(run([vendor, '1abcdef0123456'], [`vendor: ${vendor}`, `again: ${vendor}`])).toBe('vendor: ***\nagain: ***\n');
    expect(run([KEY, 'GhIjKlMnZZZZ'], [`whole key: ${KEY}`, `again: ${KEY}`])).toBe('whole key: ***\nagain: ***\n');
    // The next line opens a hold of its own.
    const opens = run([KEY, 'GhIjKlMnZZZZ'], [`whole key: ${KEY}`, 'next: sk-ant', 'x']);
    expect(opens).not.toContain('GhIjKlMn');
    expect(opens).not.toContain('sk-ant');
    // A periodic literal: 16 of its 17 bytes were held after it left whole.
    const a17 = 'a'.repeat(17);
    expect(run([a17, '020gh2daf0'], [`p ${a17}`, 'q 020gh2daf0'])).toBe('p ***\nq ***\n');
    // Part of the hold left with the first literal and part did not: the part that did not
    // leaves masked, never in clear.
    const partly = run([vendor, 'c71Xyz-00000'], [`v ${vendor}Xy`, `z-1 and ${vendor}`]);
    for (const piece of ['c71', 'Xy', vendor.slice(0, -3)]) expect(partly).not.toContain(piece);
    expect(partly).toContain('z-1 and ***');
  });

  it('S-BTN-119: a literal inside, or overlapping, another is masked as one run, in either order of the set', () => {
    for (const [set, text] of [
      [['ABCDEFGHIJ', 'ABCDEFGHIJKLMNOP'], 'x ABCDEFGHIJKLMNOP y'],
      [['ABCDEFGHIJKLMNOP', 'ABCDEFGHIJ'], 'x ABCDEFGHIJKLMNOP y'],
      [['AAAAxyzw12', 'xyzw12345678'], 'x AAAAxyzw12345678 y'],
      [['xyzw12345678', 'AAAAxyzw12'], 'x AAAAxyzw12345678 y'],
      [['hunter2hunter2', 'postgres://u:hunter2hunter2@db.internal/prod'], 'x postgres://u:hunter2hunter2@db.internal/prod y'],
    ] as Array<[string[], string]>) {
      expect(maskLegOutput(text, set)).toBe('x *** y');
      const sink = createLegMasker(set);
      expect([sink.push(text), sink.flush()].join('\n')).toBe('x *** y\n');
    }
    // A literal repeated back to back is one run: nothing between them to keep.
    expect(maskLegOutput(`${KEY}${KEY} ${KEY}`, [KEY])).toBe('*** ***');
  });

  it('S-BTN-119: a long run of a periodic literal is masked in linear time and memory', () => {
    const set = [...Array.from({ length: 20 }, (_, i) => 'a'.repeat(8 + i)), `${'a'.repeat(30)}b`];
    const line = 'a'.repeat(4 << 20);
    const t = performance.now();
    const sink = createLegMasker(set);
    const said = [sink.push(line), sink.flush()].join('\n');
    // Generous: about 0.3 s here; the quadratic span list took 4 s and 1.9 GB for a quarter of this.
    expect(performance.now() - t).toBeLessThan(10_000);
    expect(said).not.toMatch(/a/);
    expect(maskLegOutput(`x ${line} y`, set)).toBe('x *** y');
  }, 30_000);

  it('classes 5 and 6 are masked through the sink, and a `$&` secret with them', () => {
    const sink = createLegMasker(['pa$$w0rd$&x$1y']);
    expect(sink.push('Authorization: Bearer bmr_abc123DEF')).toBe('Authorization: Bearer ***');
    expect(sink.push('the password is pa$$w0rd$&x$1y.')).toBe('the password is ***.');
    expect(sink.push('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe('');
    expect(sink.push('AAAA')).toBe('');
    expect(sink.push('-----END OPENSSH PRIVATE KEY-----')).toBe('***');
    expect(sink.flush()).toBe('');
  });
});

describe('a failed leg\'s end detail (B-256, S-BTN-231, §9.4)', () => {
  it('is the failure\'s last line — an agent stub\'s, the agent\'s own last output — masked, as §10.4 free text of at most 200 characters', () => {
    const error = "the implement agent exited 0, but no open PR on a branch matching claude/B-52-* for ticket B-52 — open one, or the leg fails here; the agent's last output:\n  working\n  Reviewer B's model (deepinfra) failed: insufficient balance <" + KEY + '> {retry}';
    expect(failureDetail(error, [KEY])).toBe("Reviewer B's model (deepinfra) failed: insufficient balance *** retry");
    // A class 5 token in the line goes too, as in the log line.
    expect(failureDetail('boom\nthe provider refused bmr_' + 'b'.repeat(32), [])).toBe('the provider refused ***');
    // Control characters become spaces; a long line keeps its head, bounded.
    expect(failureDetail('a\tb\u0007c', [])).toBe('a b c');
    const long = failureDetail('x'.repeat(500), []);
    expect(long).toHaveLength(FAILURE_DETAIL_MAX);
    expect(long?.endsWith('…')).toBe(true);
    // Nothing left is no detail at all.
    expect(failureDetail('\n  \n', [])).toBeNull();
    expect(failureDetail('<>{}', [])).toBeNull();
  });
});

describe('runner.json mask_env (R-BTN-144)', () => {
  it('lists names, absent or not JSON names none, and a malformed list is refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-170-mask-'));
    try {
      const path = join(dir, 'runner.json');
      writeFileSync(path, JSON.stringify({ origin: 'https://baton.test', mask_env: ['VENDOR_THING', 'ANOTHER'] }));
      expect(readMaskEnv(path)).toEqual(['VENDOR_THING', 'ANOTHER']);
      writeFileSync(path, JSON.stringify({ origin: 'https://baton.test' }));
      expect(readMaskEnv(path)).toEqual([]);
      writeFileSync(path, 'not json');
      expect(readMaskEnv(path)).toBeNull();
      // Round 1, should-fix: a damaged file that asks for masking by name does not turn the
      // operator's list off in silence — the runner refuses to start, as a malformed list does.
      writeFileSync(path, '{"mask_env": ["VENDOR_THING",]}');
      expect(() => readMaskEnv(path)).toThrow(/not JSON, so its mask_env cannot be read/);
      expect(readMaskEnv(join(dir, 'absent.json'))).toBeNull();
      for (const bad of [{ mask_env: 'VENDOR_THING' }, { mask_env: [1] }, { mask_env: [''] }, { mask_env: { a: 'b' } }]) {
        writeFileSync(path, JSON.stringify(bad));
        expect(() => readMaskEnv(path)).toThrow(/mask_env must be a list of environment variable names/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the path is $BATON_CONFIG, else <XDG_CONFIG_HOME|~/.config>/baton/runner.json; a .baton/ path is a repository\'s', () => {
    expect(runnerConfigPath({ BATON_CONFIG: '/etc/baton/runner.json' })).toBe('/etc/baton/runner.json');
    expect(runnerConfigPath({ XDG_CONFIG_HOME: '/cfg', HOME: '/home/u' })).toBe('/cfg/baton/runner.json');
    expect(runnerConfigPath({ HOME: '/home/u' })).toBe('/home/u/.config/baton/runner.json');
    expect(underBatonDirectory('/etc/baton/runner.json')).toBe(false);
    expect(underBatonDirectory('/srv/repo/.baton/runner.json')).toBe(true);
  });
});
