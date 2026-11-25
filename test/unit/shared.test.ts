// R-BTN-37: the source modules also run in the Workers bundle.
import { describe, it, expect } from 'vitest';
import * as baton from '../../src/shared/baton.mjs';
import * as vocabulary from '../../src/shared/vocabulary.mjs';

describe('src/shared', () => {
  it('bundles and runs in the Workers runtime', () => {
    expect([...vocabulary.capabilitiesOf(['agent-venue'])].sort()).toEqual(['authentication', 'create-pr', 'drivable-browser', 'llm-call']);
    expect(vocabulary.fitsTier(null, 'judgement')).toBe(false);
    expect(baton.familyOf('opencode-go/deepseek-v4-pro', { families: { deepseek: ['deepseek'] } })).toBe('deepseek');
  });
});
