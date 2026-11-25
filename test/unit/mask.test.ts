// B-169 (R-BTN-144, S-BTN-98): the one list of what a leg's output may not carry. The runner's
// stream and an archiver's transcripts read the same pattern, so what it masks is checked here,
// once: every bearer prefix Baton issues — `bmr_` and `bps_` among them — and a private key
// block whole, and nothing that is not one (a prefix inside a longer word, the same letters
// without its underscore).
import { describe, it, expect } from 'vitest';
import { BEARER_TOKEN, KEY_HOLD, createMasker, maskSecrets } from '../../src/shared/mask.mjs';

describe('B-169 the masking pattern', () => {
  it('masks every bearer prefix Baton issues, each with its own characters', () => {
    for (const token of ['brt_abc-DEF_9', 'bak_0123456789abcdef_' + 'a'.repeat(64), 'bmcp_xyz', 'bps_0123456789abcdef_secret', 'bds_0123456789abcdef_secret', 'bmo_client', 'bmr_refresh-1_2', 'bor_resource']) {
      expect(maskSecrets(`x ${token} y`)).toBe('x *** y');
    }
  });

  it('masks a private key block whole, closed or not', () => {
    const block = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----';
    expect(maskSecrets(`key:\n${block}\ndone`)).toBe('key:\n***\n***\n***\ndone');
    expect(maskSecrets('key: -----BEGIN RSA PRIVATE KEY-----\nMIIE')).toBe('key: ***\n***');
    // Every line of the body goes, and the text around the block does not — one token per line,
    // each replaced whole.
    expect(maskSecrets(`a\nBEGIN -----BEGIN RSA PRIVATE KEY----- x\nMIIE\n-----END RSA PRIVATE KEY-----\nafter`)).toBe('a\nBEGIN ***\n***\n***\nafter');
  });

  it('leaves what is not a credential alone', () => {
    for (const text of ['xbps_left', 'abrt_y', 'bring_', 'bbrt_', 'a bps ', '-----BEGIN CERTIFICATE-----']) {
      expect(maskSecrets(text)).toBe(text);
    }
    expect(BEARER_TOKEN.source).toContain('bps|bds');
    expect(BEARER_TOKEN.flags).toBe('g');
  });

  it('a stream masks a key printed over several lines whole, and passes the rest on', () => {
    // The sink is handed one line at a time: the body is held until the `END` line.
    const m = createMasker();
    expect(m.push('before')).toBe('before');
    expect(m.push('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe('');
    expect(m.push('b3BlbnNzaC1rZXktdjEAAAAA')).toBe('');
    expect(m.push('-----END OPENSSH PRIVATE KEY-----')).toBe('***');
    expect(m.push('after')).toBe('after');
    expect(m.flush()).toBe('');
    // A block never closed is held no longer than `KEY_HOLD` bytes, then masked whole.
    const open = createMasker();
    expect(open.push('-----BEGIN RSA PRIVATE KEY-----')).toBe('');
    const chunk = 'A'.repeat(1024);
    for (let i = 0; i < 15; i++) expect(open.push(chunk)).toBe('');
    expect(open.push(chunk)).toBe('***');
    expect(open.flush()).toBe('');
    // One the stream ends inside of is masked as it ends.
    const cut = createMasker();
    expect(cut.push('-----BEGIN RSA PRIVATE KEY-----')).toBe('');
    expect(cut.flush()).toBe('***');
    expect(KEY_HOLD).toBe(16 * 1024);
    // A token on a line the stream passes on is masked as it leaves, and a `BEGIN` line's own
    // text before the block stays.
    expect(createMasker().push('x bps_secret')).toBe('x ***');
    const mid = createMasker();
    expect(mid.push('key: -----BEGIN RSA PRIVATE KEY-----')).toBe('key:');
    expect(mid.push('MIIE')).toBe('');
    expect(mid.push('-----END RSA PRIVATE KEY-----')).toBe('***');
  });
});
