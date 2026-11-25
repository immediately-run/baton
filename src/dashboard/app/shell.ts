// shell.ts — what the shell knows and every part below it may read: the session's registry
// entries (`GET /v1/actions`, the controls' one source), `repo.list`'s answer and the session's
// role from it. Read-only: nothing here decides a permission.
import { createContext, useContext } from 'react';
import type { Action, RepoList, SessionRole } from '../lib/types';

export interface ShellState {
  actions: readonly Action[];
  repos: RepoList;
  role: SessionRole | null;
}

export const NO_REPOS: RepoList = { repositories: [], session: null, link_hosts: [], session_hosts: [] };

export const ShellContext = createContext<ShellState>({ actions: [], repos: NO_REPOS, role: null });

export const useShell = (): ShellState => useContext(ShellContext);
