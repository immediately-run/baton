// B-169 (R-BTN-144, S-BTN-98): the one list of what a leg's output may not carry. The runner's
// stream and an archiver's transcripts read the same pattern, so what it masks is checked here,
// once: every bearer prefix Baton issues — `bmr_` and `bps_` among them — and a private key
// block whole, and nothing that is not one (a prefix inside a longer word, the same letters
// without its underscore).
import { describe, it, expect } from 'vitest';
import { BEARER_TOKEN, PRIVATE_KEY_BLOCK, maskSecrets } from '../../src/shared/mask.mjs';

describe('B-169 the masking pattern', () => {
  it('masks every bearer prefix Baton issues, each with its own characters', () => {
    for (const token of ['brt_abc-DEF_9', 'bak_0123456789abcdef_' + 'a'.repeat(64), 'bmcp_xyz', 'bps_0123456789abcdef_secret', 'bds_0123456789abcdef_secret', 'bmo_client', 'bmr_refresh-1_2', 'bor_resource']) {
      expect(maskSecrets(`x ${token} y`)).toBe('x *** y');
    }
  });

  it('masks a private key block whole, closed or not', () => {
    const block = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----';
    expect(maskSecrets(`key:\n${block}\ndone`)).toBe('key:\n***\ndone');
    expect(maskSecrets('key: -----BEGIN RSA PRIVATE KEY-----\nMIIE')).toBe('key: ***');
  });

  it('leaves what is not a credential alone', () => {
    for (const text of ['xbps_left', 'abrt_y', 'bring_', 'bbrt_', 'a bps ', '-----BEGIN CERTIFICATE-----']) {
      expect(maskSecrets(text)).toBe(text);
    }
    expect(BEARER_TOKEN.source).toContain('bps|bds');
    expect(PRIVATE_KEY_BLOCK.flags).toBe('g');
  });
});
