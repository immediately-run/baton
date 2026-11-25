// S-BTN-43 / R-BTN-74. Inputs and expected ticket fields from the pinned Dibber
// valid conformance stores ([DIB-12](https://github.com/immediately-run/dibber/blob/main/tickets/DIB-12.md)).
import { describe, expect, it } from 'vitest';
import { ticketsMarkdown } from '../../src/defaults/tickets-markdown';
import { stores } from './dibber-conformance.json';

const withdrawn = new Set(['withdrawn', 'deferred', 'superseded']);

describe('Dibber valid conformance stores', () => {
  for (const [name, { store, files, tickets }] of Object.entries(stores)) {
    it(`reads ${name}`, () => {
      const result = ticketsMarkdown(files, { items: store });
      const live = tickets.filter(({ status }) => status !== 'done' && !withdrawn.has(status));
      const closed = tickets.filter(({ status }) => status === 'done' || withdrawn.has(status));
      expect(result.tickets.map(({ id }) => id).sort()).toEqual(live.map(({ id }) => id).sort());
      expect(result.closed).toEqual(expect.arrayContaining(closed.map(({ id, status }) => ({
        id, as: status === 'done' ? 'done' : 'withdrawn',
      }))));
      expect(result.closed).toHaveLength(closed.length);
      for (const { id, status, parent, depends_on } of live) {
        const ticket = result.tickets.find((entry) => entry.id === id);
        expect(ticket?.display).toEqual({ status });
        expect(ticket?.parent ?? null).toBe(parent);
        expect(ticket?.depends_on).toEqual(depends_on);
      }
    });
  }
});
