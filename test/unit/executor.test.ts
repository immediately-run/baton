import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { builtinExecutor } from '../../src/runner/executor';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

it('S-BTN-48: the builtin executor collects the wrapper result even when exit precedes pipe drain', async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 12345, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
  });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
  const executor = builtinExecutor();
  const handle = await executor.start({ brief: {
    kind: 'leg', session_id: 'replay', checkout: '.', paths: [], wrapper: 'legProcess.mjs', env: {},
  } });
  try {
    const lines: string[] = [];
    const call = executor.exec(handle, ['node', 'legProcess.mjs'], { cwd: '.', onStderr: (line) => lines.push(line) });
    child.stderr.write('final ');
    child.emit('exit', 0);
    // Reap the group before waiting for close: its children can still hold the pipes open.
    expect(kill).toHaveBeenCalledWith(-child.pid, 'SIGKILL');
    const stdout = '\n{"ok":true,"result":{"version":"two"}}\n';
    child.stdout.end(stdout);
    child.stderr.end('diagnostic');
    child.emit('close', 0);
    expect(await call.result).toEqual({ status: 0, stdout, stderr: 'final diagnostic' });
    expect(lines).toEqual(['final diagnostic']);
  } finally {
    await executor.stop(handle, 'test-ended');
    kill.mockRestore();
  }
});
