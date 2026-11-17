import { AI_MODELS, AI_PROVIDERS, currentLanguage, isMessageKey, translate, type AiProvider, type AssistantStatus, type GlobalConfig, type MessageKey } from '@studio/core';
import type { Translate } from '../i18n/i18n';

/** Otto's standing rule, as the panel header and About say it: a message key, translated where it shows. */
export const OTTO_RULE: MessageKey = 'common.ottoRule';

/** Core's process language, for callers without the `I18n` service; a component passes `I18n.t`, so it follows a switch. */
const processT: Translate = (key, params) => translate(currentLanguage(), key, params);

/** A model id as its name ("Claude Opus 5.5"), or the id itself when it is not one of the listed models. */
export function modelName(id: string): string {
  return AI_MODELS.find((m) => m.id === id)?.label ?? id;
}

/** How Otto reaches Claude, in the words of Settings' provider choice. */
export function providerLabel(provider: AiProvider, t: Translate = processT): string {
  const key = `common.provider.${provider}`;
  return isMessageKey(key) ? t(key) : (AI_PROVIDERS.find((p) => p.id === provider)?.label ?? provider);
}

/** Claude Code's effort level in words ("high"); an unknown level as it is. */
export function effortLabel(effort: string, t: Translate = processT): string {
  const key = `common.effort.${effort}`;
  return isMessageKey(key) ? t(key) : effort;
}

/**
 * What Otto runs on, as the panel header shows it: the API model's name ("Claude Opus 5.5"), or Claude
 * Code with its version and, with `detail`, the model and effort chosen in Settings.
 */
export function ottoModelLabel(status: AssistantStatus | null | undefined, ai: GlobalConfig['ai'] | null | undefined, options: { model?: string; detail?: boolean; t?: Translate } = {}): string {
  const t = options.t ?? processT;
  if (status?.provider === 'claude-code') {
    const base = `Claude Code${status.claudeCode?.version ? ` ${status.claudeCode.version}` : ''}`;
    if (!options.detail) return base;
    return [base, ai?.claudeCodeModel, ai?.claudeCodeEffort && t('common.effort', { effort: effortLabel(ai.claudeCodeEffort, t) })].filter(Boolean).join(' · ');
  }
  const id = options.model ?? status?.model;
  return id ? modelName(id) : '';
}

/** The name an agent's call or edit is signed with: "Otto · Claude Opus 5.5" for the assistant (its model or `claude-code <version>`), "MCP · <client>" for others. */
export function agentSignature(caller: 'assistant' | 'mcp' | string, agent: string): string {
  return caller === 'assistant' ? `Otto · ${modelName(agent)}` : `MCP · ${agent}`;
}
