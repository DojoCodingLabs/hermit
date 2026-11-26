import type { ConnectorSpec, OperationSpec } from "../src/index.ts";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

export const listOp = (over: Partial<OperationSpec> = {}): OperationSpec => ({
  name: "list_items",
  title: "List items",
  description: "List the user's items, newest first.",
  sideEffects: [],
  method: "GET",
  path: "/v1/lists/{listId}/items",
  inputSchema: obj({ listId: { type: "string" }, q: { type: "string", maxLength: 100 } }, ["listId"]),
  scopes: ["items.read"],
  effect: "read",
  destructive: false,
  idempotent: true,
  domain: "tasks",
  risk: "network",
  ...over,
});

export const createOp = (over: Partial<OperationSpec> = {}): OperationSpec => ({
  name: "create_item",
  title: "Create an item",
  description: "Create an item in a list. Retrying creates a duplicate.",
  sideEffects: ["creates"],
  method: "POST",
  path: "/v1/lists/{listId}/items",
  inputSchema: obj({ listId: { type: "string" }, text: { type: "string", maxLength: 200 } }, ["listId", "text"]),
  scopes: ["items.write"],
  effect: "write",
  destructive: false,
  idempotent: false,
  domain: "tasks",
  risk: "remote_write",
  ...over,
});

export const deleteOp = (over: Partial<OperationSpec> = {}): OperationSpec => ({
  name: "delete_item",
  title: "Delete an item",
  description: "Delete one item for good.",
  sideEffects: ["deletes"],
  method: "DELETE",
  path: "/v1/items/{itemId}",
  inputSchema: obj({ itemId: { type: "string" } }, ["itemId"]),
  scopes: ["items.write"],
  effect: "delete",
  destructive: true,
  idempotent: true,
  domain: "tasks",
  risk: "remote_write",
  ...over,
});

export function testSpec(over: Partial<ConnectorSpec> = {}): ConnectorSpec {
  return {
    id: "acme_tasks",
    version: 1,
    name: "Acme Tasks",
    hosts: ["api.acme.example"],
    auth: [{ type: "api_key", in: "header", name: "Authorization", prefix: "Bearer " }],
    operations: [listOp(), createOp(), deleteOp()],
    transforms: [],
    origin: "drafted",
    ...over,
  };
}
