// baton.ts — the `Baton` Durable Object (BATON_SPEC §3, §3a R-BTN-55): wiring only. It hands
// the core its ports — `ctx.storage` as the Store, the object's alarm as the Scheduler,
// `waitUntil` for dispatches — and passes every request and alarm through. The object's input
// gate is what runs one request at a time between awaits (§3).
import { DurableObject } from 'cloudflare:workers';
import { BatonCore } from '../core/baton';
import { dispatchWorkflow } from '../core/mirror';
import { parseAdminKeys } from '../core/auth';
import type { Cursor, EventArchive, Row, SqlValue, Store } from '../core/ports';

/** `ctx.storage` as the core's Store: the same synchronous SQLite, unchanged. */
export function durableStore(storage: DurableObjectStorage): Store {
  return {
    exec: <T = Row>(query: string, ...params: unknown[]) => storage.sql.exec(query, ...(params as SqlValue[])) as unknown as Cursor<T>,
    script: (sql: string) => void storage.sql.exec(sql),
    transaction: <T>(fn: () => T) => storage.transactionSync(fn),
  };
}

function r2EventArchive(bucket: R2Bucket): EventArchive {
  return async (parts) => {
    for (const { repository, day, ndjson } of parts) {
      const key = `events/${repository}/${day}.ndjson`;
      const previous = await bucket.get(key);
      const options: R2PutOptions = {
        onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/x-ndjson' },
      };
      if (!previous) {
        if (!await bucket.put(key, ndjson, options)) throw new Error(`R2 did not acknowledge ${key}`);
        continue;
      }

      // Rewrite the daily object without buffering it in Worker memory. The conditional put
      // must not replace bytes added since our read, even if a second writer used the key.
      const bytes = new TextEncoder().encode(ndjson);
      const stream = new FixedLengthStream(previous.size + bytes.byteLength);
      const reader = previous.body.getReader();
      const source = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const chunk = await reader.read();
          if (!chunk.done) controller.enqueue(chunk.value);
          else {
            controller.enqueue(bytes);
            controller.close();
          }
        },
        cancel: (reason) => reader.cancel(reason),
      });
      const abort = new AbortController();
      const put = async () => {
        try {
          if (!await bucket.put(key, stream.readable, options)) throw new Error(`R2 did not acknowledge ${key}`);
        } catch (error) {
          abort.abort(error);
          throw error;
        }
      };
      const [write, copy] = await Promise.allSettled([put(), source.pipeTo(stream.writable, { signal: abort.signal })]);
      if (write.status === 'rejected') throw write.reason;
      if (copy.status === 'rejected') throw copy.reason;
    }
  };
}

export class Baton extends DurableObject<Env> {
  readonly core: BatonCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const archive = env.BATON_EVENT_ARCHIVE;
    this.core = new BatonCore({
      store: durableStore(ctx.storage),
      scheduler: { get: () => ctx.storage.getAlarm(), set: (at) => ctx.storage.setAlarm(at) },
      archiveEvents: archive && r2EventArchive(archive),
      config: env,
      dispatch: { send: (target) => dispatchWorkflow(env.GITHUB_DISPATCH_TOKEN, target), defer: (work) => ctx.waitUntil(work) },
      adminKeys: { list: () => parseAdminKeys(env.BATON_ADMIN_KEYS ?? '') },
      accessIdentities: { read: () => env.ACCESS_IDENTITIES ?? '' },
    });
    // The object refuses to serve until every migration is applied (§3), and keeps one alarm.
    ctx.blockConcurrencyWhile(() => this.core.start());
  }

  fetch(req: Request): Promise<Response> {
    return this.core.fetch(req);
  }

  alarm(): Promise<void> {
    return this.core.alarm();
  }
}
