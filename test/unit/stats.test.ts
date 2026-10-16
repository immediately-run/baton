// stats.test.ts — the course record's summaries (src/core/stats.ts; R3-1248, round 1, 1-B-5): how
// many, the median (the mean of the middle two for an even count) and the longest, in seconds.
import { describe, it, expect } from 'vitest';
import { durations } from '../../src/core/stats';

describe('durations', () => {
  it('none, one, an odd and an even count, in any order; seconds rounded', () => {
    expect(durations([])).toEqual({ count: 0, median_s: null, max_s: null });
    expect(durations([90_000])).toEqual({ count: 1, median_s: 90, max_s: 90 });
    expect(durations([300_000, 60_000, 120_000])).toEqual({ count: 3, median_s: 120, max_s: 300 });
    expect(durations([60_000, 240_000, 120_000, 600_000])).toEqual({ count: 4, median_s: 180, max_s: 600 });
    expect(durations([1_499, 1_500])).toEqual({ count: 2, median_s: 1, max_s: 2 });
  });
});
