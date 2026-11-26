import { FORBIDDEN_PATH_KEYS } from "../runtime.ts";

export type JsonObject = Record<string, unknown>;

/**
 * JSON from a server, as an object with no key that names the prototype chain at any depth. Metadata and
 * tool results are later spread, copied and hashed; dropping these keys at parse time means no later copy can
 * reach a prototype.
 */
export function parseJsonObject(text: string): JsonObject | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text, (key, v: unknown) => (FORBIDDEN_PATH_KEYS.has(key) ? undefined : v));
  } catch {
    return undefined;
  }
  return isObject(value) ? value : undefined;
}

export const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

export function str(o: JsonObject, key: string): string | undefined {
  const v = Object.hasOwn(o, key) ? o[key] : undefined;
  return typeof v === "string" && v ? v : undefined;
}

export function strArr(o: JsonObject, key: string): string[] | undefined {
  const v = Object.hasOwn(o, key) ? o[key] : undefined;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
}

export function bool(o: JsonObject, key: string): boolean | undefined {
  const v = Object.hasOwn(o, key) ? o[key] : undefined;
  return typeof v === "boolean" ? v : undefined;
}
