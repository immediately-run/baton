// readonlyFixture.tsx — what the read-only screens' tests share (B-198, B-199, B-200, B-214,
// B-215): the props the shell hands a screen, a hostile string, and the check that a screen
// draws no control and no markup from a read's text.
import { expect } from 'vitest';
import { SCREENS } from '../../src/core/screens';
import type { ScreenProps } from '../../src/dashboard/screens/contract';
import type { RepoList } from '../../src/dashboard/lib/types';

export const HOSTILE = '<img src=x onerror=alert(1)>';
export const FP = 'SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg';
export const FP2 = 'SHA256:ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210zyxwvut';

/** A screen's props, as the router builds them. */
export function propsFor(id: string, repos: RepoList, params: Record<string, string> = {}): ScreenProps {
  const screen = SCREENS.find((s) => s.id === id);
  if (!screen) throw new Error(`no screen ${id}`);
  return { screen, params, repository: repos.repositories.find((r) => r.id === params.repository) ?? null, repos, role: repos.session?.role ?? null };
}

/** Read-only (§11.4, B-191's Decision 1a): nothing to press, type into or submit — and nothing
 *  a hostile string turned into an element. */
export function expectNoControl(container: HTMLElement) {
  expect(container.querySelectorAll('button, input, select, textarea, form, [role="button"]').length).toBe(0);
  expect(container.querySelectorAll('img, script, iframe').length).toBe(0);
}

/** The CLI lines a screen draws, as text. */
export const cliLines = (container: HTMLElement): string[] => [...container.querySelectorAll('.how code.cli')].map((c) => c.textContent ?? '');

/** A table's rows as their cells' text. */
export function tableText(container: HTMLElement, label: string): string[][] {
  const table = container.querySelector(`table[aria-label="${label}"]`);
  if (!table) return [];
  return [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent ?? ''));
}
