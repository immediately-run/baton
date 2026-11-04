// stripFrontmatter.mjs — the one place a spec reader skips a page's YAML frontmatter (B-180).
//
// Every file of `spec/` is a Grove page, so each opens with a `---` block (`title`,
// `description`, …). The spec's readers — check-spec, spec-tools (`spec:impact`), spec-files
// (the index and B-179's joined-equality proof) and anything else that reads a spec file's text —
// read the body after it, so rule, scenario and gate ids, `§n.m` numbers and line numbers within
// the body are what they were. Only a block that opens the file counts: a `---` thematic break
// later in the body is text.

/** The frontmatter block that opens `text` — from its first `---` line through the closing `---`
 *  line and that line's newline — or '' when the text opens with none. */
export function frontmatterBlock(text) {
  const m = /^---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? m[0] : '';
}

/** `text` without the frontmatter block it opens with; unchanged when it has none. */
export function stripFrontmatter(text) {
  return text.slice(frontmatterBlock(text).length);
}
