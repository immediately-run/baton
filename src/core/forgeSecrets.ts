import { BatonError } from './http';
import type { Config, ForgeDispatch } from './ports';

export function forgeSecrets(config: Config): Record<string, { forge?: unknown; gitlab_issuer?: unknown; webhook?: unknown; trigger_token?: unknown }> {
  try {
    return JSON.parse(config.BATON_FORGE_SECRETS ?? '{}') ?? {};
  } catch {
    throw new BatonError('unavailable', 'the forge secrets are unreadable');
  }
}

export const adapterForge = (adapter: ForgeDispatch) => ({ 'github-app': 'github', 'gitlab-trigger': 'gitlab', gitea: 'gitea' })[adapter.kind];

export function dispatchToken(config: Config, repository: string, adapter: ForgeDispatch): string | undefined {
  const entry = forgeSecrets(config)[repository];
  return entry?.forge === adapterForge(adapter) && typeof entry.trigger_token === 'string' && entry.trigger_token.trim() ? entry.trigger_token : undefined;
}
