// R-BTN-128: this is a client-side adapter. Neither client sends storage credentials to Baton.
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type LogWriter = (name: string, body: string) => Promise<void>;
export type LogReader = (name: string) => Promise<string | null>;

export async function logStore(dir: string): Promise<{ read: LogReader; create: LogWriter }> {
  const url = new URL(dir);
  if (url.protocol === 'file:') {
    const path = fileURLToPath(url);
    return {
      async read(name) {
        try { return await readFile(join(path, name), 'utf8'); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
      },
      async create(name, body) {
        await mkdir(path, { recursive: true, mode: 0o700 });
        const temp = join(path, `.${randomUUID()}`);
        await writeFile(temp, body, { flag: 'wx', mode: 0o600 });
        // Publish atomically and never replace an existing name. O_EXCL also protects the temp.
        try { await link(temp, join(path, name)); } finally { await unlink(temp); }
      },
    };
  }
  const bucket = url.hostname;
  const prefix = url.pathname.slice(1);
  if (url.protocol === 's3:') {
    const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const endpoint = process.env.AWS_ENDPOINT_URL_S3;
    const client = new S3Client({ maxAttempts: 1, ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });
    return {
      async read(name) {
        try {
          const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: prefix + name }), { abortSignal: AbortSignal.timeout(30_000) });
          return await res.Body!.transformToString();
        } catch (e) { if ((e as Error).name === 'NoSuchKey') return null; throw e; }
      },
      async create(name, body) {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: prefix + name, Body: body, IfNoneMatch: '*' }), { abortSignal: AbortSignal.timeout(30_000) });
      },
    };
  }
  if (url.protocol === 'gs:') {
    const { Storage } = await import('@google-cloud/storage');
    const storage = new Storage({ retryOptions: { autoRetry: false }, timeout: 30_000 }).bucket(bucket);
    return {
      async read(name) {
        try { return (await storage.file(prefix + name).download())[0].toString('utf8'); }
        catch (e) { if ((e as { code?: number }).code === 404) return null; throw e; }
      },
      async create(name, body) {
        await storage.file(prefix + name).save(body, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
      },
    };
  }
  throw new Error('unsupported log storage scheme');
}
