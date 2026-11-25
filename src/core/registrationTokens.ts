// R-BTN-117 / S-BTN-69: repository-scoped runner enrolment. No secret enters SQL.
import { equalBytes, parseApiKeyLine, parseSshKey } from './auth';
import { logEvent, randomHex } from './db';
import { BatonError } from './http';
import type { Store } from './ports';
import { sha256Hex } from './runnerApi';
import { bad, checkRegistrationTokenId, DAY_MS, registrationBody, registrationObject, registrationTokenId, tokenScope } from './validate';
import { capabilitiesOf } from '../shared/vocabulary.mjs';

interface Token {
  repository_id: string;
  secret_hash: string;
  capabilities: string;
  uses_left: number;
  grant_ttl_s: number;
  expires_at: number;
  revoked_at: number | null;
  api_keys: number;
}

export class RegistrationTokens {
  constructor(private readonly store: Store, private readonly now: () => number) {}

  async mint(repository: string, actor: string, body: unknown, authorize: () => void) {
    const id = randomHex(8);
    const token = `brt_${id}_${randomHex(32)}`;
    const hash = await sha256Hex(token);
    this.store.transaction(() => {
      authorize();
      const scope = tokenScope(body);
      const expanded = [...new Set(capabilitiesOf(scope.capabilities))].sort();
      if (expanded.some((c) => c === 'human-operator' || c === 'capability:human-operator')) bad('capabilities', 'human-operator is not a token capability');
      const now = this.now();
      this.store.exec(`INSERT INTO registration_tokens
        (id, repository_id, secret_hash, capabilities, uses_left, grant_ttl_s, expires_at, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, repository, hash, JSON.stringify(expanded),
      scope.uses, scope.grantTtl, now + scope.ttl * 1000, actor, now);
      logEvent(this.store, now, 'admin', actor, { act: 'token-created', token_id: id }, null, null, repository);
    });
    return { id, token };
  }

  revoke(repository: string, rawId: string, actor: string, body: unknown, authorize: () => void) {
    const id = checkRegistrationTokenId(rawId);
    if (registrationObject(body, ['confirm']).confirm !== true) bad('confirm', 'must be true');
    return this.store.transaction(() => {
      authorize();
      const now = this.now();
      const token = this.store.exec('UPDATE registration_tokens SET revoked_at = ?, uses_left = 0 WHERE id = ? AND repository_id = ? AND revoked_at IS NULL RETURNING id', now, id, repository).toArray();
      if (!token.length) throw new BatonError('not-found', 'no live registration token with that id');
      this.store.exec(`UPDATE runner_grants SET revoked_at = ? WHERE revoked_at IS NULL AND credential_id IN
        (SELECT id FROM credentials WHERE registration_token_id = ?)`, now, id);
      this.store.exec('UPDATE credentials SET revoked_at = ? WHERE registration_token_id = ? AND revoked_at IS NULL', now, id);
      logEvent(this.store, now, 'admin', actor, { act: 'token-revoked', token_id: id }, null, null, repository);
      return { ok: true };
    });
  }

  async register(token: string, raw: unknown, current: string | null, keyInUse: (id: string) => boolean, writable: () => void) {
    const tokenId = registrationTokenId(token);
    if (!tokenId) throw new BatonError('unauthenticated', 'a registration token is required');
    const { name, publicKey } = registrationBody(raw);
    const hash = await sha256Hex(token);
    const apiKey = publicKey == null ? `bak_${randomHex(8)}_${randomHex(32)}` : null;
    const api = publicKey == null ? null : parseApiKeyLine(publicKey);
    const ssh = publicKey == null || api ? null : await parseSshKey(publicKey);
    const id = api?.fingerprint ?? ssh?.fingerprint ?? apiKey!.slice(0, 20);
    const line = api?.line ?? (ssh ? publicKey!.trim().split(/\s+/).slice(0, 2).join(' ') : `${id} sha256:${await sha256Hex(apiKey!)}`);
    return this.store.transaction(() => {
      writable();
      const now = this.now();
      const t = this.store.exec(`SELECT t.*, r.api_keys FROM registration_tokens t JOIN repositories r ON r.id = t.repository_id
        WHERE t.id = ? AND r.retired_at IS NULL`, tokenId).toArray()[0] as unknown as Token | undefined;
      const bytes = new TextEncoder();
      if (!equalBytes(bytes.encode(hash), bytes.encode(t?.secret_hash ?? '0'.repeat(64))) || !t || t.revoked_at != null || t.expires_at <= now) {
        throw new BatonError('unauthenticated', 'unknown, expired or revoked registration token');
      }
      if ((api || apiKey) && !t.api_keys) throw new BatonError('forbidden', 'this repository does not allow API-key runners');
      const held = this.store.exec(`SELECT id, registration_token_id FROM credentials WHERE hostname = ? AND kind IN ('runner', 'token')
        AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND (last_used_at IS NULL OR last_used_at > ?)`, name, now, now - 7 * DAY_MS).toArray();
      const rekey = current != null && held.length === 1 && held[0].id === current && held[0].registration_token_id === tokenId;
      if (rekey && current.startsWith('bak_') && !t.api_keys) throw new BatonError('forbidden', 'this repository does not allow API-key runners');
      if (!rekey && t.uses_left === 0) throw new BatonError('unauthenticated', 'this registration token is spent');
      if ((held.length && !rekey) || (current != null && !rekey)) throw new BatonError('conflict', 'this name is bound to another credential');
      if (keyInUse(id)) throw new BatonError('conflict', 'this key is already registered');

      if (rekey && !this.store.exec('SELECT 1 FROM runner_grants WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL', current, t.repository_id).toArray().length) {
        throw new BatonError('forbidden', 'the grant for this credential was revoked');
      }
      // Clear the unique live-name slot before installing the replacement. No other live key
      // can share the name; expired credentials cannot authenticate even before this cleanup.
      this.store.exec(`UPDATE credentials SET revoked_at = ? WHERE hostname = ? AND kind = 'runner' AND revoked_at IS NULL`, now, name);
      const expiresAt = now + t.grant_ttl_s * 1000;
      this.store.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind, public_key, created_by, registration_token_id, expires_at, last_used_at)
        VALUES (?, ?, '[]', 'runner', ?, 'owner:registration-token', ?, ?, ?)`, id, name, line, tokenId, expiresAt, now);
      this.store.exec(`INSERT INTO runner_grants (credential_id, repository_id, capabilities, granted_by, granted_at, accepted_at)
        VALUES (?, ?, ?, ?, ?, ?)`, id, t.repository_id, t.capabilities, `token:${tokenId}`, now, now);
      if (rekey) {
        this.store.exec('UPDATE runner_grants SET revoked_at = ? WHERE credential_id = ? AND revoked_at IS NULL', now, current);
        this.store.exec('UPDATE runners SET credential_id = ? WHERE credential_id = ?', id, current);
      } else {
        this.store.exec('UPDATE registration_tokens SET uses_left = uses_left - 1 WHERE id = ?', tokenId);
      }
      this.store.exec('DELETE FROM token_registrations WHERE token_id = ? AND at <= ?', tokenId, now - DAY_MS);
      this.store.exec('INSERT INTO token_registrations (token_id, at) VALUES (?, ?)', tokenId, now);
      const count = this.store.exec('SELECT COUNT(*) AS n FROM token_registrations WHERE token_id = ?', tokenId).toArray()[0].n;
      logEvent(this.store, now, 'admin', `token:${tokenId}`, { act: 'runner-registered', credential_id: id, rekey }, null, null, t.repository_id);
      if (count === 11) logEvent(this.store, now, 'admin', 'baton', { act: 'baton.token-burst', token_id: tokenId }, null, null, t.repository_id);
      const grant = { repository_id: t.repository_id, capabilities: JSON.parse(t.capabilities) as string[], accepted_at: now, expires_at: expiresAt };
      return { credential_id: id, grant, ...(apiKey ? { api_key: apiKey } : {}) };
    });
  }
}
