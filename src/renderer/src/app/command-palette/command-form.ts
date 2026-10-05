/** A field of the palette's generated form, read from a command's JSON Schema. */
export interface FormFieldSpec {
  key: string;
  label: string;
  description?: string;
  kind: 'text' | 'number' | 'enum' | 'boolean' | 'json';
  required: boolean;
  options?: string[];
  defaultValue?: unknown;
}

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  description?: string;
  default?: unknown;
  anyOf?: JsonSchema[];
}

const words = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** One field per top-level property; anything that is not a plain value becomes a JSON field. */
export function formFields(schema: unknown): FormFieldSpec[] {
  const root = (schema ?? {}) as JsonSchema;
  const required = new Set(root.required ?? []);
  return Object.entries(root.properties ?? {}).map(([key, prop]) => {
    const base = { key, label: words(key), description: prop.description, required: required.has(key), defaultValue: prop.default };
    const type = Array.isArray(prop.type) ? prop.type.find((t) => t !== 'null') : prop.type;
    if (prop.enum && prop.enum.every((v) => typeof v === 'string')) return { ...base, kind: 'enum', options: prop.enum as string[] };
    if (type === 'string') return { ...base, kind: 'text' };
    if (type === 'number' || type === 'integer') return { ...base, kind: 'number' };
    if (type === 'boolean') return { ...base, kind: 'boolean' };
    return { ...base, kind: 'json' };
  });
}

/** Builds the command input from the form's text values and flags; throws a readable error for bad JSON or numbers. */
export function buildInput(fields: FormFieldSpec[], values: Record<string, string>, flags: Record<string, boolean>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.kind === 'boolean') {
      input[field.key] = flags[field.key] ?? false;
      continue;
    }
    const raw = (values[field.key] ?? '').trim();
    if (!raw) continue;
    if (field.kind === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`${field.label} must be a number`);
      input[field.key] = n;
    } else if (field.kind === 'json') {
      try {
        input[field.key] = JSON.parse(raw);
      } catch {
        throw new Error(`${field.label} must be valid JSON`);
      }
    } else {
      input[field.key] = raw;
    }
  }
  return input;
}

/** Initial text values and flags from the schema defaults. */
export function initialValues(fields: FormFieldSpec[]): { values: Record<string, string>; flags: Record<string, boolean> } {
  const values: Record<string, string> = {};
  const flags: Record<string, boolean> = {};
  for (const field of fields) {
    if (field.kind === 'boolean') flags[field.key] = field.defaultValue === true;
    else if (field.defaultValue !== undefined) values[field.key] = field.kind === 'json' ? JSON.stringify(field.defaultValue) : String(field.defaultValue);
    else values[field.key] = '';
  }
  return { values, flags };
}
