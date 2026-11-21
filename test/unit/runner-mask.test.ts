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

// S-BTN-98/S-BTN-99: the writer and reader share the real create-only file adapter.
describe('leg log archive', () => {
  it('masks split credentials, keeps separate streams and refuses replacement', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const { logStore } = await import('../../src/runner/logStore');
    const { LegLog } = await import('../../src/runner/legLog');
    const dir = await mkdtemp(join(tmpdir(), 'baton-log-'));
    try {
      const store = await logStore(pathToFileURL(dir).href);
      const failures: string[] = [];
      const log = new LegLog(store.create, ['my-secret-value', 'first-part\r\nsecond-part'], () => failures.push('failed'));
      log.push('stdout', Buffer.from('good my-secret-'));
      log.push('stderr', Buffer.from('stderr line\n'));
      log.push('stdout', Buffer.from('value and bak_'));
      log.push('stdout', Buffer.from('sensitive\n'));
      log.push('stderr', Buffer.from('-----BEGIN TEST PRIVATE KEY-----\nprivate-content\n'));
      log.push('stderr', Buffer.from(`${'a'.repeat(1024)}\n`.repeat(20) + 'private-after-limit\n'));
      log.push('stderr', Buffer.from('-----END TEST PRIVATE KEY-----\n'));
      log.push('stdout', Buffer.from('first-part\r\nsecond-part\r\n'));
      await log.finish({ claim: 1, leg: 'implement', run: 1, run_id: 'r_test' });
      expect(failures).toEqual([]);
      const body = (await store.read('000000.jsonl'))!;
      expect(body.trim().split('\n').map((line) => JSON.parse(line))).toMatchObject([
        { seq: 0, stream: 'stderr', text: 'stderr line\n' },
        { seq: 1, stream: 'stdout', text: 'good *** and ***\n' },
        { seq: 2, stream: 'stderr', text: '***\n' },
        { seq: 3, stream: 'stdout', text: '***\n' },
      ]);
      expect(JSON.parse((await store.read('end.json'))!)).toMatchObject({ chunks: 1, frames: 4, gaps: 0 });
      await expect(store.create('000000.jsonl', 'overwrite')).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await store.read('000000.jsonl')).toBe(body);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('fails closed with a gap on an overlong unbroken line', async () => {
    const { LegLog } = await import('../../src/runner/legLog');
    const chunks = new Map<string, string>();
    const log = new LegLog(async (name, data) => { chunks.set(name, data); }, [], () => {});
    log.push('stdout', Buffer.from('visible\n'));
    log.push('stdout', Buffer.from('bak_' + 'a'.repeat(256 * 1024)));
    log.push('stdout', Buffer.from('\nnever written\n'));
    await log.finish({ claim: 1, leg: 'implement', run: 1, run_id: 'r_test' });
    expect(chunks.get('000000.jsonl')).toContain('visible');
    expect(chunks.get('000001.jsonl')).toBe('{"gap":1}\n');
    expect(JSON.parse(chunks.get('end.json')!)).toMatchObject({ chunks: 2, frames: 1, truncated: true });
  });
});

it('S-BTN-99 follows create-only chunks through the end marker and sanitizes the terminal', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { logStore } = await import('../../src/runner/logStore');
  const { viewLog } = await import('../../src/runner/logView');
  const { vi } = await import('vitest');
  const dir = await mkdtemp(join(tmpdir(), 'baton-log-follow-'));
  const out: string[] = [];
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
  try {
    const log_dir = pathToFileURL(dir).href;
    const store = await logStore(log_dir);
    const write = (name: string, value: object) => store.create(name, `${JSON.stringify(value)}\n`);
    await write('000000.jsonl', { seq: 0, stream: 'stdout', text: '\x1b[31mfirst\x1b[0m\x07\n' });
    let polled = false;
    expect(await viewLog({ run: 1, log_dir }, { follow: true, json: false, transcripts: false, refresh: async () => {
      polled = true;
      await write('000001.jsonl', { gap: 1 });
      await write('000002.jsonl', { seq: 2, stream: 'stderr', text: 'last\n' });
      await write('end.json', { chunks: 3 });
      return { run: 1, ended_at: 2, log_dir };
    } })).toBe(0);
    expect(polled).toBe(true);
    expect(out.join('')).toBe('first\n[gap]\nlast\n');
  } finally { stdout.mockRestore(); await rm(dir, { recursive: true, force: true }); }
});
