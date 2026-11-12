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
  MIN_SECRET_BYTES, SECRET_NAME_EXACT, SECRET_NAME_SUFFIXES, createLegMasker, holdLiteralTail,
  maskLegOutput, namesASecret, readMaskEnv, runnerConfigPath, secretValues, underBatonDirectory,
} from '../../src/runner/mask';

const KEY = 'sk-ant-api03-AbCdEfGhIjKlMn';
const PAT = 'github_pat_11ABCDEFG0123456789';

describe('class 7 by name (R-BTN-144)', () => {
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
