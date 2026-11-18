// runner-replay.test.ts — `baton leg replay`'s pure half (BATON_SPEC §9.8 R-BTN-84; B-190): the
// flags (unknown ones refused, never dropped), which run the flags name (by number, by id, the
// newest), R-BTN-144's replay environment (the allowlist — nothing of the runner's own keeps),
// the version check's comparison (a moved version or read digest is a mismatch; a pinned source
// read at its version agrees), and a `git:` pointer's slug. The advance's `run_inputs` shape
// (§13.5 `leg_run_inputs`) is checked beside checkAdvance's; the whole replay runs in
// S-BTN-48's integration test, over a real repository.
import { describe, it, expect } from 'vitest';
import { compareRead, parseReplayArgs, pickRun, replayEnvironment, replayMain, slugOf, type RecordedRun } from '../../src/runner/replay';
import { checkAdvance, checkRunInputs } from '../../src/core/validate';
import { graphOf } from '../../src/core/graph';

const ENV = { BATON_HOME: '/home/leg/docs', BATON_URL: 'https://baton.test', PATH: '/usr/bin', LANG: 'C', TERM: 'xterm' };

describe('parseReplayArgs: the flags, unknown ones refused', () => {
  const key = ['/home/leg/owner.key'];
  const base = ['docs:T-1', 'implement', '-i', ...key];
  it('takes the ticket, the leg and the key; --home and --url default to the environment', () => {
    expect(parseReplayArgs(base, ENV)).toMatchObject({ repository: 'docs', ticket: 'T-1', leg: 'implement', home: '/home/leg/docs', url: 'https://baton.test', acceptMoved: false, executor: 'builtin' });
  });
  it('names the run by number or id, one of the two', () => {
    expect(parseReplayArgs([...base, '--run', '3'], ENV).run).toBe(3);
    expect(parseReplayArgs([...base, '--run-id', 'r_01J'], ENV).runId).toBe('r_01J');
    expect(() => parseReplayArgs([...base, '--run', '3', '--run-id', 'r_01J'], ENV)).toThrow(/one run/);
    expect(() => parseReplayArgs([...base, '--run', '0'], ENV)).toThrow(/at least 1/);
  });
  it('keeps --env names and --against, and accepts a moved ticket deliberately', () => {
    const a = parseReplayArgs([...base, '--accept-moved', '--against', '0123456789abcdef', '--env', 'ANTHROPIC_API_KEY', '--env', 'TZ'], ENV);
    expect(a).toMatchObject({ acceptMoved: true, against: '0123456789abcdef' });
    expect(a.envNames).toEqual(['ANTHROPIC_API_KEY', 'TZ']);
  });
  it('refuses an unknown flag, a bare ticket, a missing key and a bad leg', () => {
    expect(() => parseReplayArgs([...base, '--wibble'], ENV)).toThrow(/not a flag/);
    expect(() => parseReplayArgs(['T-1', 'implement', '-i', ...key], ENV)).toThrow(/<repository>:<id>/);
    expect(() => parseReplayArgs(['docs:T-1', 'implement'], ENV)).toThrow(/-i KEY/);
    expect(() => parseReplayArgs(['docs:T-1', 'Implement', '-i', ...key], ENV)).toThrow(/leg id/);
  });
  it('--help answers the usage before any credential or network work', async () => {
    const lines: string[] = [];
    expect(await replayMain(['--help'], { log: (l) => lines.push(l), env: ENV })).toBe(0);
    expect(lines[0]).toMatch(/^baton leg replay <repository>:<ticket> <leg>/);
  });
});

describe('pickRun: which run the flags name', () => {
  const run = (n: number, id: string): RecordedRun => ({ run: n, run_id: id, claim: n, started_at: n, snapshot_sha: `${n}${'a'.repeat(39)}`, inputs: [] });
  const runs = [run(1, 'r_one'), run(2, 'r_two'), run(3, 'r_three')];
  it('absent flags name the newest; --run and --run-id name exactly', () => {
    expect(pickRun(runs, {}).run).toMatchObject({ run: 3 });
    expect(pickRun(runs, { run: 2 }).run).toMatchObject({ run: 2 });
    expect(pickRun(runs, { runId: 'r_one' }).run).toMatchObject({ run: 1 });
  });
  it('names what is missing, never a guess', () => {
    expect(pickRun(runs, { run: 9 })).toMatchObject({ run: null, why: expect.stringMatching(/no run 9/) });
    expect(pickRun(runs, { runId: 'r_nine' })).toMatchObject({ run: null, why: expect.stringMatching(/r_nine/) });
    expect(pickRun([], {})).toMatchObject({ run: null, why: expect.stringMatching(/no recorded runs/) });
  });
});

describe('replayEnvironment: R-BTN-144\'s allowlist', () => {
  it('keeps PATH, LANG, TZ, TERM and an isolated HOME; nothing else of the runner\'s own', () => {
    const env = replayEnvironment({ ...ENV, BATON_TOKEN: 'tok', SSH_AUTH_SOCK: '/sock', GIT_ASKPASS: '/ask', HOME: '/home/leg', CREDENTIALS: 'x' }, { home: '/tmp/replay-home' });
    expect(env).toEqual({ HOME: '/tmp/replay-home', PATH: '/usr/bin', LANG: 'C', TERM: 'xterm', BATON_REPLAY: '1' });
  });
  it('keeps the --env and replay_env names — a model provider\'s key among them', () => {
    const env = replayEnvironment({ ...ENV, ANTHROPIC_API_KEY: 'sk-ant-secret', MY_TOOL_HOME: '/tool' }, { home: '/tmp/h', envNames: ['ANTHROPIC_API_KEY'], replayEnv: ['MY_TOOL_HOME'] });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-secret');
    expect(env.MY_TOOL_HOME).toBe('/tool');
  });
});

describe('compareRead: the version check\'s comparison (R-BTN-84)', () => {
  const recorded = { version: '5:aaaaaaaaaaaaaaaa', read_digest: 'sha256:7d6a..' };
  it('agrees when both the version and the read digest agree; a pinned read is at its version', () => {
    expect(compareRead(recorded, { version: '5:aaaaaaaaaaaaaaaa', digest: 'sha256:7d6a..' }, 'current')).toMatchObject({ ok: true });
    expect(compareRead(recorded, { version: '5:aaaaaaaaaaaaaaaa', digest: 'sha256:7d6a..' }, 'pinned')).toMatchObject({ ok: true });
  });
  it('a moved version or a moved digest is a mismatch, whichever moved', () => {
    expect(compareRead(recorded, { version: '6:bbbbbbbbbbbbbbbb', digest: 'sha256:7d6a..' }, 'current')).toMatchObject({ ok: false, why: expect.stringMatching(/version is 6:bbbb/) });
    expect(compareRead(recorded, { version: '5:aaaaaaaaaaaaaaaa', digest: 'sha256:ffff..' }, 'current')).toMatchObject({ ok: false, why: expect.stringMatching(/digest differs/) });
    expect(compareRead(recorded, { version: '5:aaaaaaaaaaaaaaaa', digest: 'sha256:ffff..' }, 'pinned')).toMatchObject({ ok: false, why: expect.stringMatching(/digest differs/) });
  });
  it('a source that no longer reads, and a run that recorded no version, are findings too', () => {
    expect(compareRead(recorded, null, 'current')).toMatchObject({ ok: false, why: expect.stringMatching(/no longer reads/) });
    expect(compareRead(undefined, { version: '5:aaaaaaaaaaaaaaaa', digest: 'sha256:7d6a..' }, 'pinned')).toMatchObject({ ok: false, why: expect.stringMatching(/recorded no ticket version/) });
  });
});

describe('slugOf: a remote\'s owner/name as a git: pointer spells it', () => {
  it('reads the https and ssh spellings of one repository the same', () => {
    expect(slugOf('https://github.com/immediately-run/docs.git')).toBe('immediately-run/docs');
    expect(slugOf('git@github.com:immediately-run/docs.git')).toBe('immediately-run/docs');
  });
});

describe('checkRunInputs: the advance\'s run report (§13.5 leg_run_inputs)', () => {
  it('is absent by default; the ticket row carries the version and its read\'s digest', () => {
    expect(checkAdvance({ leg: 'implement' }).run_inputs).toEqual({ ticket: null, inputs: [] });
    const a = checkAdvance({ leg: 'implement', run_inputs: { ticket: { version: '5:aaaa', read_digest: `sha256:${'a'.repeat(64)}` } } });
    expect(a.run_inputs.ticket).toEqual({ version: '5:aaaa', read_digest: `sha256:${'a'.repeat(64)}` });
  });
  it('takes each input as a pointer or a bounded inline value, never both', () => {
    const a = checkAdvance({
      leg: 'implement',
      run_inputs: { inputs: [
        { name: 'review', uri: 'git:immediately-run/docs@' + 'a'.repeat(40) + ':review/1.json', digest: `sha256:${'b'.repeat(64)}` },
        { name: 'note', value: { said: 'ship it' } },
      ] },
    });
    expect(a.run_inputs.inputs).toEqual([
      { name: 'review', from_leg: null, from_run: null, uri: `git:immediately-run/docs@${'a'.repeat(40)}:review/1.json`, digest: `sha256:${'b'.repeat(64)}`, value: null, hasValue: false, leg_version: null },
      { name: 'note', from_leg: null, from_run: null, uri: '', digest: null, value: { said: 'ship it' }, hasValue: true, leg_version: null },
    ]);
  });
  it('refuses a name twice, a value with a digest, an unshaped digest and an unknown field', () => {
    expect(() => checkRunInputs({ inputs: [{ name: 'a', value: 1 }, { name: 'a', value: 2 }] })).toThrow(/repeats a/);
    expect(() => checkRunInputs({ inputs: [{ name: 'a', value: 1, digest: 'sha256:x' }] })).toThrow(/inline value carries no digest/);
    expect(() => checkRunInputs({ ticket: { version: 'v', read_digest: 'md5:zz' } })).toThrow(/read_digest/);
    expect(() => checkRunInputs({ inputs: [{ name: 'a', value: 1, extra: true }] })).toThrow(/not an input field/);
  });
});

describe('graphOf: a leg\'s replay_safe', () => {
  it('is true unless the course file marks it false — the marker replay refuses on', () => {
    const g = graphOf({
      start: 'filed', start_leg: 'implement', end: ['merged'], stations: { filed: {}, done: {} },
      legs: {
        implement: { from: ['filed'], to: 'done' },
        fix: { from: ['filed'], to: 'done', replay_safe: false },
      },
    });
    expect(g.legs.get('implement')?.replaySafe).toBe(true);
    expect(g.legs.get('fix')?.replaySafe).toBe(false);
  });
});
