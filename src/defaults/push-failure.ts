import { LegError } from '../runner/legClient.mjs';

/** Git reports a ref or authorization refusal separately from a failed transport. */
export function pushFailure(error: unknown): unknown {
  const stderr = (error as { stderr?: string } | null)?.stderr ?? '';
  const refusal = stderr.split('\n').find((line) => /\[(?:remote )?rejected\]|Permission denied|Authentication failed|returned error: 40[13]\b/i.test(line));
  return refusal ? new LegError('error.blocked', `git push refused: ${refusal.trim()}`) : error;
}
