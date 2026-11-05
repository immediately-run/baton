// stripFrontmatter (B-180): the one helper every spec reader uses to skip a page's frontmatter.
import { describe, expect, it } from 'vitest';
import { frontmatterBlock, stripFrontmatter } from './stripFrontmatter.mjs';

describe('stripFrontmatter (B-180)', () => {
  it('drops the block a page opens with, through the closing line', () => {
    const text = '---\ntitle: "6. Prerequisites"\ndescription: "A leg starts."\n---\n## 6. Prerequisites\n\nBody.\n';
    expect(stripFrontmatter(text)).toBe('## 6. Prerequisites\n\nBody.\n');
    expect(frontmatterBlock(text)).toBe('---\ntitle: "6. Prerequisites"\ndescription: "A leg starts."\n---\n');
  });

  it('leaves a page with no frontmatter as it is', () => {
    const text = '## 1. What Baton is\n\nBaton hands out tickets.\n';
    expect(stripFrontmatter(text)).toBe(text);
    expect(frontmatterBlock(text)).toBe('');
  });

  it('leaves a `---` rule later in the body untouched, with or without a block before it', () => {
    const body = '## 2. Two\n\nAbove.\n\n---\n\nBelow.\n';
    expect(stripFrontmatter(body)).toBe(body);
    expect(stripFrontmatter(`---\ntitle: T\n---\n${body}`)).toBe(body);
  });

  it('takes an empty block, and only a block that opens the file', () => {
    expect(stripFrontmatter('---\n---\n# Page\n')).toBe('# Page\n');
    expect(stripFrontmatter('\n---\ntitle: T\n---\nBody\n')).toBe('\n---\ntitle: T\n---\nBody\n');
  });
});
