// S-BTN-98: a bounded, best-effort archive, independent of the claim's completion.
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as sleep } from 'node:timers/promises';
import { logMask } from './logMask';
import type { LogWriter } from './logStore';

type Stream = 'stdout' | 'stderr';
const CHUNK = 256 * 1024;
const BUFFER = 8 * 1024 * 1024;
const CAP = 50 * 1024 * 1024;
export const chunkName = (n: number) => `${String(n).padStart(6, '0')}.jsonl`;

export class LegLog {
  private incoming: string[] = [];
  private pending: { text: string; size: number; count: number }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private size = 0;
  private buffered = 0;
  private seq = 0;
  private chunks = 0;
  private bytes = 0;
  private gaps = 0;
  private dropped = 0;
  private work: Promise<void> | null = null;
  private ended: string | null = null;
  private failed = false;
  private finalized = false;
  private truncated = false;
  private readonly streams;

  constructor(private readonly create: LogWriter, secrets: readonly string[], private readonly failure: () => void | Promise<void>,
    private readonly observe?: (stream: Stream, text: string) => void) {
    const stream = () => ({ decoder: new StringDecoder('utf8'), mask: logMask(secrets) });
    this.streams = { stdout: stream(), stderr: stream() };
  }

  push(stream: Stream, data: Buffer): void {
    if (this.failed || this.truncated || this.ended) return;
    const s = this.streams[stream];
    this.frame(stream, s.mask(s.decoder.write(data)));
  }

  private frame(stream: Stream, text: string): void {
    if (text) this.observe?.(stream, text);
    let part = '';
    let size = 0;
    for (const cp of text) {
      const n = Buffer.byteLength(cp);
      if (size + n > 8192) { this.append(stream, part); part = ''; size = 0; }
      part += cp;
      size += n;
    }
    if (part) this.append(stream, part);
  }

  private append(stream: Stream, text: string): void {
    if (this.truncated || this.failed) return;
    const line = JSON.stringify({ seq: this.seq, at: new Date().toISOString(), stream, text }) + '\n';
    const size = Buffer.byteLength(line);
    if (this.bytes + size > CAP - 128) { this.truncate(); return; }
    if (this.size + size > CHUNK) this.seal();
    this.incoming.push(line);
    this.seq++;
    this.size += size;
    this.bytes += size;
    this.timer ??= setTimeout(() => this.seal(), 1000);
    this.timer.unref();
  }

  private truncate(): void {
    if (this.truncated) return;
    this.truncated = true;
    this.seal();
  }

  private seal(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.size) {
      this.pending.push({ text: this.incoming.join(''), size: this.size, count: this.incoming.length });
      this.buffered += this.size;
      this.size = 0;
      this.incoming = [];
      while (this.buffered > BUFFER - 2 * CHUNK) {
        const oldest = this.pending.shift()!;
        this.buffered -= oldest.size;
        this.dropped += oldest.count;
      }
    }
    this.kick();
  }

  private kick(): void {
    if (this.failed || this.finalized || this.work) return;
    this.work = this.write().catch(async () => { this.failed = true; this.pending = []; await this.failure(); }).finally(() => {
      this.work = null;
      if (this.pending.length || this.dropped || (this.ended && !this.finalized)) this.kick();
    });
  }

  private async retry(name: string, body: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try { await this.create(name, body); return; }
      catch (e) {
        if (attempt === 4 || ['EEXIST', 'PreconditionFailed'].includes((e as { code?: string }).code ?? (e as Error).name) || (e as { code?: number }).code === 412) throw e;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }

  private async write(): Promise<void> {
    while (this.pending.length || this.dropped) {
      if (this.dropped) {
        const gap = this.dropped;
        this.dropped = 0;
        await this.retry(chunkName(this.chunks++), `${JSON.stringify({ gap })}\n`);
        this.gaps++;
      } else {
        const next = this.pending.shift()!;
        this.buffered -= next.size;
        await this.retry(chunkName(this.chunks++), next.text);
      }
    }
    if (this.ended && !this.finalized) {
      if (this.truncated) {
        await this.retry(chunkName(this.chunks++), '{"gap":1}\n');
        this.gaps++;
      }
      await this.retry('end.json', JSON.stringify({ ...JSON.parse(this.ended), chunks: this.chunks,
        frames: this.seq, bytes: this.bytes, gaps: this.gaps, truncated: this.truncated }));
      this.finalized = true;
    }
  }

  async finish(run: { claim: number; leg: string; run: number; run_id: string }): Promise<void> {
    if (!this.failed && !this.truncated) {
      for (const stream of ['stdout', 'stderr'] as const) {
        const s = this.streams[stream];
        this.frame(stream, s.mask(s.decoder.end(), true));
      }
    }
    this.ended = JSON.stringify({ ...run, ended_at: new Date().toISOString() });
    this.seal();
    while (this.work) await this.work;
  }
}
