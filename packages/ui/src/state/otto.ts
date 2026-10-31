import { AI_MODELS, AI_PROVIDERS, type AiProvider, type AssistantStatus, type GlobalConfig } from '@studio/core';

/** Otto's standing rule, as the panel header and About say it. */
export const OTTO_RULE = 'asks before deleting';

/** A model id as its name ("Claude Opus 5.5"), or the id itself when it is not one of the listed models. */
export function modelName(id: string): string {
  return AI_MODELS.find((m) => m.id === id)?.label ?? id;
}

/** How Otto reaches Claude, in the words of Settings' provider choice. */
export function providerLabel(provider: AiProvider): string {
  return AI_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
}

/**
 * What Otto runs on, as the panel header shows it: the API model's name ("Claude Opus 5.5"), or Claude
 * Code with its version and, with `detail`, the model and effort chosen in Settings.
 */
export function ottoModelLabel(status: AssistantStatus | null | undefined, ai: GlobalConfig['ai'] | null | undefined, options: { model?: string; detail?: boolean } = {}): string {
  if (status?.provider === 'claude-code') {
    const base = `Claude Code${status.claudeCode?.version ? ` ${status.claudeCode.version}` : ''}`;
    if (!options.detail) return base;
    return [base, ai?.claudeCodeModel, ai?.claudeCodeEffort && `${ai.claudeCodeEffort} effort`].filter(Boolean).join(' · ');
  }
  const id = options.model ?? status?.model;
  return id ? modelName(id) : '';
}

/** The name an agent's call or edit is signed with: "Otto · Claude Opus 5.5" for the assistant (its model or `claude-code <version>`), "MCP · <client>" for others. */
export function agentSignature(caller: 'assistant' | 'mcp' | string, agent: string): string {
  return caller === 'assistant' ? `Otto · ${modelName(agent)}` : `MCP · ${agent}`;
}
