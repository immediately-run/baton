/** R-BTN-92 and R-BTN-93: the web and CI shapes of registered repositories. */
export interface ForgeShape {
  depth: readonly [number, number];
  pr: string | null;
  blob: string | null;
  commit: string | null;
  dispatch: string | null;
  dispatchOrigin?: string;
  dispatchInput: 'workflow-path' | 'project-ref' | 'workflow-ref' | null;
  defaultOrigin: string | null;
  ci: 'github-actions' | 'gitlab-ci' | null;
}

export const FORGE_SHAPES = {
  github: { depth: [2, 2], pr: '/pull/', blob: '/blob/', commit: '/commit/', dispatch: 'github-app', dispatchOrigin: 'https://api.github.com', dispatchInput: 'workflow-path', defaultOrigin: 'https://github.com', ci: 'github-actions' },
  gitlab: { depth: [2, 4], pr: '/-/merge_requests/', blob: '/-/blob/', commit: '/-/commit/', dispatch: 'gitlab-trigger', dispatchInput: 'project-ref', defaultOrigin: null, ci: 'gitlab-ci' },
  gitea: { depth: [2, 2], pr: '/pulls/', blob: '/src/branch/', commit: '/commit/', dispatch: 'gitea', dispatchInput: 'workflow-ref', defaultOrigin: null, ci: null },
  git: { depth: [2, 2], pr: null, blob: null, commit: null, dispatch: null, dispatchInput: null, defaultOrigin: null, ci: null },
} as const satisfies Record<string, ForgeShape>;

export type Forge = keyof typeof FORGE_SHAPES;
export const FORGES = Object.keys(FORGE_SHAPES) as Forge[];
type DefaultForge = { [F in Forge]: (typeof FORGE_SHAPES)[F]['defaultOrigin'] extends string ? F : never }[Forge];
export const DEFAULT_FORGE = FORGES.find((f): f is DefaultForge => FORGE_SHAPES[f].defaultOrigin !== null)!;
export type PrForge = { [F in Forge]: (typeof FORGE_SHAPES)[F]['pr'] extends string ? F : never }[Forge];
export const PR_FORGES = FORGES.filter((f): f is PrForge => FORGE_SHAPES[f].pr !== null);
export const isForge = (value: unknown): value is Forge => typeof value === 'string' && Object.hasOwn(FORGE_SHAPES, value);
export const hasPrs = (forge: Forge): forge is PrForge => FORGE_SHAPES[forge].pr !== null;

export const WORKFLOW_PATH = /^\.github\/workflows\/[A-Za-z0-9._-]{1,100}\.ya?ml$/;
export const forgeForCi = (ci: NonNullable<ForgeShape['ci']>): Forge => FORGES.find((f) => FORGE_SHAPES[f].ci === ci)!;

const number = '(\\d{1,9})';
const suffix = (forge: PrForge) => `${FORGE_SHAPES[forge].pr}${number}`;
export const prSuffix = (forge: PrForge): RegExp => new RegExp(`^${suffix(forge)}$`);
/** A standalone answer URL, not yet checked against a registered repository. */
export const PR_URL = new RegExp(`^https?://[^/\\s?#]+(?:${PR_FORGES.map((forge) => {
  const [min, max] = FORGE_SHAPES[forge].depth;
  return `((?:/[A-Za-z0-9_.-]{1,100}){${min},${max}})${suffix(forge)}`;
}).join('|')})$`);

export function parsePrUrl(url: string): { path: string; number: string } | null {
  const groups = PR_URL.exec(url)?.slice(1).filter((v) => v !== undefined);
  return groups ? { path: groups[0].slice(1), number: groups[1] } : null;
}
