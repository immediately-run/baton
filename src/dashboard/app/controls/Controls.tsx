// Controls.tsx — a screen's control row (B-207): one button per registry entry `ui.view` places
// on the screen, the form its `input` schema gives, and the two dialogs. A call is same-origin
// JSON (R-BTN-16) to the entry's own route; on `200` every read is refetched at once; a refusal
// is drawn beside its control as code and message, as text, until the next change. A
// destructive entry opens the confirm dialog, which sends `confirm: true` (§12.2); a `202
// {confirm_code}` answer opens the code dialog (R-BTN-155) — the page never confirms, only the
// key that minted the session does. Summaries, codes and messages are text.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError, apiSend, asApiError } from '../../lib/api';
import { FAST_MS, useReadStore } from '../../lib/reads';
import { bodyOf, initialOf, readForm, type Field } from '../../lib/schemaForm';
import { textOf } from '../../lib/Text';
import { useShell } from '../shell';
import { Dialog } from './Dialog';
import { useControls, type Control } from './useControls';

/** How long a confirmation code lives (R-BTN-155): the code dialog polls for this long. */
export const CODE_MS = 120_000;

/** The target's ids, as the dialogs name them: every scalar of the context, as text. */
function TargetList({ target }: { target: Record<string, unknown> }) {
  const rows = Object.entries(target).filter(([, v]) => typeof v === 'string' || typeof v === 'number');
  if (rows.length === 0) return null;
  return (
    <dl className="kv dialog-target">
      {rows.map(([k, v]) => (
        <div className="kv-row" key={k}>
          <dt>{k.replace(/[_-]+/g, ' ')}</dt>
          <dd className="mono">{textOf(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function FieldInput({ field, id, value, fault, onChange }: { field: Field; id: string; value: string | boolean; fault?: string; onChange: (v: string | boolean) => void }) {
  const describedBy = fault ? `${id}-fault` : undefined;
  const common = { id, 'aria-invalid': fault ? true : undefined, 'aria-describedby': describedBy, title: field.description } as const;
  let input;
  if (field.kind === 'checkbox') input = <input {...common} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  else if (field.kind === 'select') {
    input = (
      <select {...common} className="input" value={String(value)} required={field.required} onChange={(e) => onChange(e.target.value)}>
        {field.required ? null : <option value="">—</option>}
        {(field.options ?? []).map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
      </select>
    );
  } else if (field.kind === 'radio') {
    input = (
      <span className="radios" role="radiogroup" aria-labelledby={`${id}-label`}>
        {(field.options ?? []).map((o) => (
          <label key={String(o)} className="radio">
            <input type="radio" name={id} value={String(o)} checked={String(value) === String(o)} onChange={() => onChange(String(o))} /> {String(o)}
          </label>
        ))}
      </span>
    );
  } else {
    input = (
      <input
        {...common}
        className="input"
        type={field.kind === 'number' ? 'number' : 'text'}
        step={field.kind === 'number' ? (field.integer ? 1 : 'any') : undefined}
        pattern={field.pattern}
        maxLength={field.maxLength}
        required={field.required}
        placeholder={field.kind === 'list' ? 'a, b, c' : undefined}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <span className="field">
      <label htmlFor={field.kind === 'radio' ? undefined : id} id={`${id}-label`} className="field-label">{field.label}{field.required ? ' *' : ''}</label>
      {input}
      {fault ? <span id={`${id}-fault`} className="field-fault" role="alert">{fault}</span> : null}
    </span>
  );
}

/** The confirmation-code dialog (B-207 item 5): the code, the action and its target, and the one
 *  line that completes it; the store polls every 5 seconds for the code's two minutes, and the
 *  dialog closes when an answer changes — the effect showing — or says the code expired. */
function CodeDialog({ code, control, target, onClose }: { code: string; control: Control; target: Record<string, unknown>; onClose: () => void }) {
  const store = useReadStore();
  const { role } = useShell();
  const [expired, setExpired] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const seen = store.changes;
    store.fast(CODE_MS);
    const off = store.watch(() => {
      if (store.changes !== seen) close.current();
    });
    const timer = setTimeout(() => setExpired(true), CODE_MS);
    return () => {
      off();
      clearTimeout(timer);
      store.fast(0);
    };
  }, [store]);
  const line = `baton ${role === 'owner' ? 'owner' : 'admin'} confirm ${code}`;
  return (
    <Dialog title="Confirm with your key" onCancel={onClose} footer={<button type="button" className="btn" data-autofocus onClick={onClose}>Close</button>}>
      <p>{control.entry.summary}</p>
      <TargetList target={target} />
      <p className="code" aria-label="Confirmation code">{code}</p>
      {expired ? (
        <p className="error-note" role="alert">Timed out: the code expired. Nothing was done.</p>
      ) : (
        <>
          <p>Run this where your key is — it shows the action and asks before it acts:</p>
          <p><code className="cli">{line}</code></p>
          <p className="mut">This page cannot confirm it: only the key that opened this session can. Waiting, checking every {FAST_MS / 1000} s for two minutes.</p>
        </>
      )}
    </Dialog>
  );
}

function ControlItem({ control, target, onDone }: { control: Control; target: Record<string, unknown>; onDone?: () => void }) {
  const store = useReadStore();
  const id = useId();
  const form = control.form;
  const fields = form.drawable ? form.fields : [];
  const [raw, setRaw] = useState<Record<string, string | boolean>>(() => Object.fromEntries(fields.map((f) => [f.path, initialOf(f)])));
  const [faults, setFaults] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<Record<string, unknown> | null>(null);
  const [code, setCode] = useState<string | null>(null);

  if (!form.drawable) {
    // B-207: a field the table cannot draw is not a button — the action is named as text.
    return (
      <span className="control control-cli" title={control.entry.summary}>
        <span className="mono">{control.entry.id}</span> <span className="mut">— from the CLI: this page cannot draw its form</span>
      </span>
    );
  }

  const send = async (values: Record<string, unknown>, confirm: boolean) => {
    setBusy(true);
    setRefusal(null);
    try {
      const res = await apiSend(control.method, control.path, bodyOf(form.preset, values, confirm ? { confirm: true } : {}));
      setOpen(false);
      setConfirming(null);
      if (res.status === 'confirm') setCode(res.code);
      else {
        onDone?.();
        await store.refresh();
      }
    } catch (e) {
      const error = asApiError(e);
      setConfirming(null);
      setRefusal(error);
      // An ended session: the polling layer hears it from its own reads and the shell signs in.
      if (error.code === 'unauthenticated') void store.refresh();
    } finally {
      setBusy(false);
    }
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    setRefusal(null);
    if (fields.length > 1 && !open) {
      setOpen(true);
      return;
    }
    const read = readForm(fields, raw);
    setFaults(read.faults);
    if (Object.keys(read.faults).length > 0) return;
    if (control.dialog) setConfirming(read.values);
    else void send(read.values, false);
  };

  const change = (path: string, v: string | boolean) => {
    setRaw((r) => ({ ...r, [path]: v }));
    setFaults((f) => (f[path] ? Object.fromEntries(Object.entries(f).filter(([k]) => k !== path)) : f));
    setRefusal(null);
  };

  const inputs = fields.map((f) => <FieldInput key={f.path} field={f} id={`${id}-${f.path}`} value={raw[f.path] ?? ''} fault={faults[f.path]} onChange={(v) => change(f.path, v)} />);
  const button = (
    <button type="submit" className={`btn${control.destructive ? ' btn-danger' : ''}`} disabled={busy} title={control.entry.summary} aria-expanded={fields.length > 1 ? open : undefined}>
      {control.label}
    </button>
  );
  return (
    <span className="control">
      <form className="control-form" onSubmit={submit} noValidate>
        {fields.length === 1 ? inputs : null}
        {fields.length > 1 && open ? (
          <span className="control-popover" role="group" aria-label={control.entry.summary}>
            {inputs}
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
          </span>
        ) : null}
        {button}
      </form>
      {refusal ? (
        <span className="control-refusal" role="alert">
          <span className="mono">{refusal.code}</span> — {refusal.message}
        </span>
      ) : null}
      {confirming ? (
        <Dialog
          title={control.label.replace(/…$/, '?')}
          onCancel={() => setConfirming(null)}
          footer={(
            <>
              <button type="button" className="btn" data-autofocus onClick={() => setConfirming(null)}>Cancel</button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void send(confirming, true)}>{control.label.replace(/…$/, '')}</button>
            </>
          )}
        >
          <p>{control.entry.summary}</p>
          <TargetList target={target} />
        </Dialog>
      ) : null}
      {code ? <CodeDialog code={code} control={control} target={target} onClose={() => setCode(null)} /> : null}
    </span>
  );
}

/** A screen's controls: `view` is the screen's id in `screens.ts` (`repository/tickets/{ticket}`),
 *  `target` the ids the screen knows — they fill the routes' parameters and the inputs' fields of
 *  the same name — and `allowed` the read's own word where it carries one. Draws nothing when
 *  the session has no entry for the screen. */
export function Controls({ view, target, allowed, label = 'Actions', onDone }: { view: string; target: Record<string, unknown>; allowed?: readonly string[] | null; label?: string; onDone?: () => void }) {
  const controls = useControls(view, target, allowed);
  if (controls.length === 0) return null;
  return (
    <div className="controls" role="group" aria-label={label}>
      {controls.map((c) => <ControlItem key={`${c.entry.id} ${c.path}`} control={c} target={target} onDone={onDone} />)}
    </div>
  );
}
