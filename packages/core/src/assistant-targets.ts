import { isId } from './ids';

/** The keys a command's input names its targets with: `plan.entity.delete` and its friends take `ids`, others `id`. */
const ID_KEYS = ['ids', 'id', 'entityIds', 'entityId', 'connectorIds', 'connectorId'] as const;

/**
 * The entity and connector ids a command's input names, for the dashed outline the plan draws round
 * what a destructive call Otto waits on would touch (`03-otto.md` §c). Best effort: the top-level id
 * keys, and the steps of a `plan.apply` batch; an input that names none gives an empty list (and the
 * plan draws nothing). Only id-shaped strings are kept; one that is no entity or connector on the plan
 * (a project's or a snapshot's) simply has nothing to outline.
 */
export function targetIdsOf(input: unknown): string[] {
  const out = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 2) return;
    const record = value as Record<string, unknown>;
    for (const key of ID_KEYS) {
      const v = record[key];
      for (const id of Array.isArray(v) ? v : [v]) if (typeof id === 'string' && isId(id)) out.add(id);
    }
    if (Array.isArray(record.steps)) for (const step of record.steps) visit((step as { input?: unknown } | null)?.input, depth + 1);
  };
  visit(input, 0);
  return [...out];
}
