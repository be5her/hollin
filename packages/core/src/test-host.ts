import { defaultConfig, mergeConfig, type ConfigPatch, type GlobalConfig } from './config';
import { StudioError } from './errors';
import type { HostApi, HostEventMessage, MutationRequest, ProjectsApi, SecretsApi } from './types';

/** A projects API with no library: there is never a current project, and everything else fails. */
const noProjects = new Proxy({} as ProjectsApi, {
  get: (_target, key) => {
    if (key === 'resolve') return async (hint: string | null) => {
      if (hint) throw new StudioError('NOT_FOUND', `No project with id ${hint}`);
      return undefined;
    };
    if (key === 'current') return () => null;
    if (key === 'openProjects' || key === 'list') return () => [];
    return () => {
      throw new StudioError('INTERNAL', `The test host has no project library (${String(key)})`);
    };
  },
});

/** An in-memory host for unit tests: config, secrets and the events that were emitted. */
export function testHost(options: { config?: ConfigPatch; confirm?: (request: MutationRequest) => boolean } = {}): HostApi & { events: HostEventMessage[] } {
  let config: GlobalConfig = mergeConfig(defaultConfig(), options.config ?? {});
  const values = new Map<string, string>();
  const secrets: SecretsApi = {
    persistent: false,
    has: (name) => values.has(name),
    get: (name) => values.get(name),
    set: async (name, value) => void values.set(name, value),
    delete: async (name) => void values.delete(name),
  };
  const events: HostEventMessage[] = [];
  const listeners = new Set<(message: HostEventMessage) => void>();
  return {
    version: 'test',
    platform: 'test',
    config: {
      get: () => config,
      update: async (patch) => (config = mergeConfig(config, patch)),
    },
    secrets,
    projects: noProjects,
    execute: () => Promise.reject(new StudioError('INTERNAL', 'The test host runs no other commands')),
    meta: () => undefined,
    emit: (event, payload) => {
      const message = { event, payload } as HostEventMessage;
      events.push(message);
      for (const listener of [...listeners]) listener(message);
    },
    on: (event, listener) => {
      const wrapped = (message: HostEventMessage) => void (message.event === event && listener(message.payload as never));
      listeners.add(wrapped);
      return () => void listeners.delete(wrapped);
    },
    confirmMutation: options.confirm ? async (request) => options.confirm!(request) : undefined,
    events,
  };
}
