import { defaultConfig, mergeConfig, type ConfigPatch, type GlobalConfig } from './config';
import type { HostApi, HostEventMessage, MutationRequest, SecretsApi } from './types';

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
  return {
    version: 'test',
    platform: 'test',
    config: {
      get: () => config,
      update: async (patch) => (config = mergeConfig(config, patch)),
    },
    secrets,
    emit: (event, payload) => void events.push({ event, payload } as HostEventMessage),
    confirmMutation: options.confirm ? async (request) => options.confirm!(request) : undefined,
    events,
  };
}
