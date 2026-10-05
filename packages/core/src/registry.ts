import { StudioError } from './errors';
import type { AnyZodObject, CommandContext, CommandDefinition, CommandMeta, ModuleMain } from './types';

interface Registered {
  module: string;
  command: CommandDefinition;
}

/**
 * Every feature is a set of commands; this is the one place they run. The UI, the command palette,
 * the MCP server and the in-app assistant all call `execute`, so they all get the same checks.
 */
export class CommandRegistry {
  private readonly commands = new Map<string, Registered>();
  private readonly modules = new Map<string, ModuleMain>();

  register(moduleId: string, command: CommandDefinition): void {
    if (this.commands.has(command.id)) throw new Error(`Command "${command.id}" is registered twice`);
    this.commands.set(command.id, { module: moduleId, command });
  }

  registerModule(mod: ModuleMain): void {
    if (this.modules.has(mod.id)) throw new Error(`Module "${mod.id}" is registered twice`);
    this.modules.set(mod.id, mod);
    for (const command of mod.commands) this.register(mod.id, command);
  }

  listModules(): ModuleMain[] {
    return [...this.modules.values()];
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  get(id: string): Registered | undefined {
    return this.commands.get(id);
  }

  meta(id: string): CommandMeta | undefined {
    const entry = this.commands.get(id);
    return entry ? toMeta(entry) : undefined;
  }

  list(): CommandMeta[] {
    return [...this.commands.values()].map(toMeta);
  }

  /**
   * In order: unknown id, missing project, input validation, the mutating gate, then the handler.
   * Throws StudioError; the host turns that into `{ ok: false, error }`.
   */
  async execute<O = unknown>(id: string, rawInput: unknown, ctx: CommandContext): Promise<O> {
    const entry = this.commands.get(id);
    if (!entry) throw new StudioError('UNKNOWN_COMMAND', `Unknown command "${id}"`);
    const { command } = entry;

    if (command.scope === 'project' && !ctx.project) {
      throw new StudioError('NO_PROJECT', `"${id}" needs an open project. Open or create one first.`);
    }

    const parsed = command.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`);
      throw new StudioError('INVALID_INPUT', `Invalid input for "${id}": ${issues.join('; ')}`, issues);
    }

    if (ctx.caller !== 'ui' && command.mutating) {
      const mutates = typeof command.mutating === 'function' ? await command.mutating(parsed.data, ctx) : true;
      if (mutates) await authorize(toMeta(entry), parsed.data, ctx);
    }
    return (await command.handler(parsed.data, ctx)) as O;
  }
}

async function authorize(meta: CommandMeta, input: unknown, ctx: CommandContext): Promise<void> {
  if (ctx.caller === 'mcp') {
    if (ctx.host.config.get().mcp.allowMutations) return;
    throw new StudioError(
      'MUTATION_BLOCKED',
      `"${meta.id}" can delete or overwrite data, and agents are not allowed to do that yet. The user can allow it in Settings > MCP.`,
    );
  }
  // The in-app assistant asks the user each time.
  if (!ctx.host.confirmMutation) {
    throw new StudioError('MUTATION_BLOCKED', `"${meta.id}" needs the user's confirmation, which this host cannot ask for.`);
  }
  const allowed = await ctx.host.confirmMutation({ command: meta, input, caller: ctx.caller, agent: ctx.agent });
  if (!allowed) throw new StudioError('MUTATION_DECLINED', `The user declined "${meta.title}".`);
}

function toMeta({ module, command }: Registered): CommandMeta {
  return {
    id: command.id,
    module,
    title: command.title,
    description: command.description,
    scope: command.scope,
    mutating: Boolean(command.mutating),
    conditional: typeof command.mutating === 'function',
    hidden: Boolean(command.hidden),
    noInput: command.input.safeParse({}).success,
    batchable: Boolean(command.batchable),
  };
}

/** Typed identity helper: the handler infers its input type from the schema. */
export function defineCommand<S extends AnyZodObject, O>(def: CommandDefinition<S, O>): CommandDefinition {
  return def as unknown as CommandDefinition;
}

export function defineModule(mod: ModuleMain): ModuleMain {
  return mod;
}
