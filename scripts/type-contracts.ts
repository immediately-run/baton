// Compile-only regressions for B-282's former ambient module shims.
import { parseArgs } from '../cli/baton.mjs';
import { isEligible } from '../src/shared/baton.mjs';
import { claudeRecords } from '../src/shared/sessionUsage.mjs';
import { translate } from './check-traces.mjs';

export function checkContracts() {
  // @ts-expect-error argv must be a string array
  parseArgs([42]);
  // @ts-expect-error every trace step must carry a projection
  translate({ steps: [{ kind: 'alarm', now: 0 }] });
  // @ts-expect-error the review-capacity path needs the matrix
  isEligible({}, { id: 'T-1', repository: 'docs', course: 'roadmap-pr' }, { lastEndReason: 'released:awaiting-review-capacity' });
  // @ts-expect-error Claude usage records may lack a timestamp
  const at: string | null = claudeRecords('')[0].at;
  return at;
}
