// contract.ts — what the shell hands every screen (B-221; see README.md beside this file).
import type { ComponentType } from 'react';
import type { Screen } from '../../core/screens';
import type { RepoList, RepoRow, SessionRole } from '../lib/types';

export interface ScreenProps {
  /** The screen's own entry of `src/core/screens.ts`: `id`, `path`, `role`. */
  screen: Screen;
  /** The URL's `{param}` segments, id-shaped: `repository`, and `ticket`, `course`, `condition`
   *  or `runner` where the path has one. */
  params: Record<string, string>;
  /** `GET /v1/repositories`'s row for `params.repository`; null on the root and tenant screens.
   *  A repository screen is only mounted when its row exists. */
  repository: RepoRow | null;
  /** The whole `repo.list` answer: every repository of the caller, `seed_owners`, the hosts. */
  repos: RepoList;
  /** The session's role, from `repo.list.session.role`. Never a reason to hide a control: the
   *  server's answer is. */
  role: SessionRole | null;
}

export type ScreenComponent = ComponentType<ScreenProps>;
