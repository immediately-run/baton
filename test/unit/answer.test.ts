// answer.test.ts — how a stub reads its agent's answer (B-85, R-BTN-131): the table of outputs
// S-BTN-104 names, against the one helper `review`, `adjudicate` and every future `Ask` leg use.
import { describe, it, expect } from 'vitest';
import { findAnswer, lastLine, requireAnswer } from '../../src/defaults/answer';

/** The `review` leg's ask: `create-pr` and `review-pr` both take approve or changes. */
const VERDICT = { name: 'verdict', values: ['approve', 'changes'] };
const PR = 'https://github.com/o/site/pull/7';

describe('findAnswer — the last line that opens with a value word, prose around it failing nothing (B-85)', () => {
  it.each([
    ['a bare word', 'approve', { answer: 'approve', pr: null, line: 'approve' }],
    ['a word and a PR URL', `changes ${PR}`, { answer: 'changes', pr: PR, line: `changes ${PR}` }],
    ['prose before the word', 'I read every hunk of the diff.\nNothing blocks the merge.\napprove', { answer: 'approve', pr: null, line: 'approve' }],
    ['prose after the word', 'approve\n\nRound 1: the diff is sound; I left no blocking note.', { answer: 'approve', pr: null, line: 'approve' }],
    ['prose on both sides of the word', 'Reading the diff first.\napprove\nDetails above.', { answer: 'approve', pr: null, line: 'approve' }],
    ['trailing blank lines', 'approve\n\n   \n', { answer: 'approve', pr: null, line: 'approve' }],
    ['prose after a word and a URL', `I looked at both PRs.\nchanges ${PR}\nTwo blocking findings, listed above: a leaked handle, a missing test.`, { answer: 'changes', pr: PR, line: `changes ${PR}` }],
    ['CRLF output', 'prose\r\napprove\r\n', { answer: 'approve', pr: null, line: 'approve' }],
    ['backticks around the word (found live, 2026-10-24)', '`changes`', { answer: 'changes', pr: null, line: '`changes`' }],
    ['bold around the word', '**approve**', { answer: 'approve', pr: null, line: '**approve**' }],
    ['quotes around the word', '"changes"', { answer: 'changes', pr: null, line: '"changes"' }],
    ['backticks around the word, a PR URL after', '`changes` https://github.com/o/r/pull/7', { answer: 'changes', pr: 'https://github.com/o/r/pull/7', line: '`changes` https://github.com/o/r/pull/7' }],
    ['an unbalanced backtick is not a wrapper', '`changes', null],
    ['a wrapper around a wrong word is not the answer', '`approved`', null],
    ['the last of two answer lines', 'approve\nOn reflection, after the fix round:\nchanges', { answer: 'changes', pr: null, line: 'changes' }],
  ])('reads %s', (_name, out, expected) => {
    expect(findAnswer(out, VERDICT.values)).toEqual(expected);
  });

  it.each([
    ['the word mid-line only', 'My verdict: approve'],
    ['a misspelled word', 'approveed'],
    ['a word that only begins with a value', `approved ${PR}`],
    ['a value with punctuation after it', 'approve.'],
    ['an answer after a non-URL word', 'approve o/site#7'],
    ['an answer with two URLs', `approve ${PR} ${PR}`],
    ['empty output', ''],
    ['whitespace only', '  \n\n\t\n'],
    ['no value word at all', 'I could not review the diff: it does not apply.'],
  ])('reads nothing from %s', (_name, out) => {
    expect(findAnswer(out, VERDICT.values)).toBeNull();
  });

  it('strict: only the one last line counts, so prose after the verdict is refused (the kit’s old behaviour)', () => {
    expect(findAnswer('prose\napprove', VERDICT.values, { strict: true })).toEqual({ answer: 'approve', pr: null, line: 'approve' });
    expect(findAnswer(`approve ${PR}`, VERDICT.values, { strict: true })).toEqual({ answer: 'approve', pr: PR, line: `approve ${PR}` });
    expect(findAnswer('approve\nDetails above.', VERDICT.values, { strict: true })).toBeNull();
    expect(findAnswer('Details first.\nMy verdict is approve.', VERDICT.values, { strict: true })).toBeNull();
    expect(findAnswer(`approve ${PR}\nDetails above.`, VERDICT.values, { strict: true })).toBeNull();
  });

  it('a value word from another ask is not this ask’s answer: values are taken as given', () => {
    expect(findAnswer('duplicate', ['new-cause', 'duplicate'])).toMatchObject({ answer: 'duplicate' });
    expect(findAnswer('duplicate', VERDICT.values)).toBeNull();
  });
});

describe('requireAnswer — a missing, misspelled or malformed verdict fails the leg, naming what it read (B-85)', () => {
  it('returns the answer it found, prose or not', () => {
    expect(requireAnswer('Reviewing.\napprove\nDone.', VERDICT, 'review')).toEqual({ answer: 'approve', pr: null, line: 'approve' });
  });

  it('names the leg, the ask and the values wanted, and the last line it read', () => {
    expect(() => requireAnswer('I read the diff.\nIt looks fine to me.', VERDICT, 'review')).toThrow(
      'the review agent printed no verdict (approve or changes) as its last line — its last line was "It looks fine to me."',
    );
    expect(() => requireAnswer('prose\naproove', VERDICT, 'review')).toThrow('— its last line was "aproove"');
    expect(() => requireAnswer('', VERDICT, 'review')).toThrow('the review agent printed no verdict (approve or changes) as its last line — its output was empty');
  });

  it('a verdict line with something that is not one PR URL after it is refused as a malformed line, not a missing verdict', () => {
    expect(() => requireAnswer('approve o/site#7', VERDICT, 'review')).toThrow('the review agent\'s last line names no PR URL after its verdict');
    // A strict reader on a last line that opens with the word but carries a second word: the same refusal.
    expect(() => requireAnswer('approve o/site#7', VERDICT, 'review', { strict: true })).toThrow('names no PR URL');
  });
});

describe('lastLine — what a refusal reports, for a leg with no answer', () => {
  it('is the last non-blank line, trimmed, or empty for no output', () => {
    expect(lastLine('a\n  b  \n\n')).toBe('b');
    expect(lastLine('')).toBe('');
    expect(lastLine('\r\n')).toBe('');
  });
});
