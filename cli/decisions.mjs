// decisions.mjs — `baton decision list` (BATON_SPEC §2g R-BTN-80, R-BTN-127): the CLI courier.
// It claims the notices queued for the user's courier key, prints each as text — the ticket's
// title, the decision's question (its id and who it asks) and its link — and marks each `sent`
// once printed; `--all` lists every open decision the key delivers, whatever its notices' state.
// Nothing here signs or fetches: `request(method, path, body)` does, so the integration scenario
// drives this same code against a Baton on either host.

/** How often `--watch` asks: once a minute (R-BTN-80). */
export const WATCH_EVERY_MS = 60_000;

/**
 * Text a terminal shows as text: control characters — an escape sequence that would recolour,
 * retitle or rewrite the terminal — become U+FFFD. Titles and links passed Baton's §10.4 checks,
 * and are still printed as data, never as instructions to the terminal.
 */
export const plain = (v) => String(v).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '\uFFFD');

/** One decision as lines of text: `<ticket> — <title>`, its question, and its link. */
export function formatDecision(d) {
  const lines = [`${plain(d.ticket)} — ${plain(d.title)}`, `  decision ${plain(d.decision.id)} (asks ${plain(d.decision.asks)})`];
  if (d.decision.url) lines.push(`  ${plain(d.decision.url)}`);
  if (d.notice_state !== undefined) lines.push(`  notice: ${d.notice_state == null ? 'none' : plain(d.notice_state)}`);
  return lines.join('\n');
}

/** A refusal, as Baton said it. */
function refused(what, res) {
  return new Error(`${what}: ${res.status} ${res.json?.code ?? ''} ${res.json?.message ?? ''}`.trim());
}

/**
 * One pass: with `all`, every open decision the key delivers; otherwise the queued notices,
 * claimed, each written by `write` and then marked `sent` with channel `cli`. A notice whose
 * decision was answered meanwhile is answered `closed` — already done, not an error. Returns how
 * many it wrote.
 */
export async function listOnce(request, write, { all = false } = {}) {
  if (all) {
    const res = await request('GET', '/v1/courier/decisions');
    if (res.status !== 200) throw refused('GET /v1/courier/decisions', res);
    for (const d of res.json.decisions) write(formatDecision(d));
    if (!res.json.decisions.length) write('no open decisions');
    return res.json.decisions.length;
  }
  const res = await request('POST', '/v1/courier/notices/claim', {});
  if (res.status !== 200) throw refused('POST /v1/courier/notices/claim', res);
  for (const n of res.json.notices) {
    write(formatDecision(n));
    const mark = await request('POST', `/v1/courier/notices/${encodeURIComponent(n.notice_id)}`, { state: 'sent', channel: 'cli' });
    if (mark.status !== 200 && mark.json?.code !== 'closed') throw refused(`marking ${n.notice_id} sent`, mark);
  }
  return res.json.notices.length;
}

/** `--watch`: a pass now and then once a minute, until `signal` aborts. */
export async function watch(request, write, { signal, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  while (!signal?.aborted) {
    await listOnce(request, write);
    if (signal?.aborted) return;
    await sleep(WATCH_EVERY_MS);
  }
}
