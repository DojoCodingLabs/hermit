import type { CredentialMeta, CredentialSecret, CredentialStorePort } from "@hermit/core";

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** In-memory credential store for tests and the eval. The phone uses a Keystore-backed adapter. */
export class MemoryCredentialStore implements CredentialStorePort {
  readonly #items = new Map<string, { meta: CredentialMeta; secret: CredentialSecret }>();

  async save(meta: CredentialMeta, secret: CredentialSecret): Promise<void> {
    if (meta.kind !== secret.kind) throw new Error(`credential ${meta.id}: a ${secret.kind} secret can't be saved as ${meta.kind}`);
    this.#items.set(meta.id, { meta: copy(meta), secret: copy(secret) });
  }

  async list(): Promise<CredentialMeta[]> {
    return [...this.#items.values()].map((i) => copy(i.meta));
  }

  async get(id: string): Promise<CredentialMeta | undefined> {
    const i = this.#items.get(id);
    return i && copy(i.meta);
  }

  async reveal(id: string): Promise<CredentialSecret | undefined> {
    const i = this.#items.get(id);
    return i && copy(i.secret);
  }

  async markUsed(id: string, at: number): Promise<boolean> {
    const i = this.#items.get(id);
    if (!i) return false;
    i.meta.lastUsedAt = at;
    return true;
  }

  async delete(id: string): Promise<boolean> {
    return this.#items.delete(id);
  }
}

export interface ContractCheck {
  name: string;
  run(): Promise<void>;
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`credential store contract: ${message}`);
}

const SECRET = "tok_contract_9f8e7d6c5b4a";

/**
 * The behavior every CredentialStorePort must have, as framework-free checks: vitest runs them against the
 * in-memory store here, and the app runs the same list against its Keystore adapter.
 */
export function credentialStoreContract(make: () => CredentialStorePort): ContractCheck[] {
  const meta = (over: Partial<CredentialMeta> = {}): CredentialMeta => ({
    id: "c1", connectorId: "google_calendar", kind: "oauth2", source: "dojo_client", scopes: ["calendar"], createdAt: 1, ...over,
  });
  const secret: CredentialSecret = { kind: "oauth2", accessToken: SECRET, refreshToken: `${SECRET}_r` };
  return [
    {
      name: "save then reveal returns the secret; get and list return the meta",
      async run() {
        const s = make();
        await s.save(meta(), secret);
        assert(JSON.stringify(await s.reveal("c1")) === JSON.stringify(secret), "reveal returns what was saved");
        assert((await s.get("c1"))?.connectorId === "google_calendar", "get returns the meta");
        assert((await s.list()).length === 1, "list has one item");
      },
    },
    {
      name: "the meta never carries the secret",
      async run() {
        const s = make();
        await s.save(meta({ account: "ana@example.com" }), secret);
        const listed = JSON.stringify([await s.list(), await s.get("c1")]);
        assert(!listed.includes(SECRET), "list and get must not include any secret value");
      },
    },
    {
      name: "rejects a secret whose kind differs from the meta's",
      async run() {
        const s = make();
        let threw = false;
        try {
          await s.save(meta({ kind: "api_key" }), secret);
        } catch {
          threw = true;
        }
        assert(threw, "save must reject a kind mismatch");
        assert((await s.get("c1")) === undefined, "nothing is stored after a rejected save");
      },
    },
    {
      name: "save replaces an existing credential",
      async run() {
        const s = make();
        await s.save(meta(), secret);
        await s.save(meta({ scopes: ["a", "b"] }), { kind: "oauth2", accessToken: "tok_second_value" });
        assert((await s.list()).length === 1, "still one item");
        assert((await s.get("c1"))?.scopes.length === 2, "meta replaced");
        const r = await s.reveal("c1");
        assert(r?.kind === "oauth2" && r.accessToken === "tok_second_value" && r.refreshToken === undefined, "secret replaced");
      },
    },
    {
      name: "returned values are copies",
      async run() {
        const s = make();
        await s.save(meta(), secret);
        const m = await s.get("c1");
        m?.scopes.push("extra");
        const r = await s.reveal("c1");
        if (r?.kind === "oauth2") r.accessToken = "changed";
        assert((await s.get("c1"))?.scopes.length === 1, "meta unchanged");
        const again = await s.reveal("c1");
        assert(again?.kind === "oauth2" && again.accessToken === SECRET, "secret unchanged");
      },
    },
    {
      name: "markUsed records the last use, and is false for an unknown id",
      async run() {
        const s = make();
        await s.save(meta(), secret);
        assert((await s.markUsed("c1", 42)) === true, "markUsed known");
        assert((await s.get("c1"))?.lastUsedAt === 42, "lastUsedAt set");
        assert((await s.markUsed("nope", 42)) === false, "markUsed unknown");
      },
    },
    {
      name: "delete removes the meta and the secret",
      async run() {
        const s = make();
        await s.save(meta(), secret);
        await s.save(meta({ id: "c2" }), secret);
        assert((await s.delete("c1")) === true, "delete known");
        assert((await s.get("c1")) === undefined && (await s.reveal("c1")) === undefined, "both gone");
        assert((await s.delete("c1")) === false, "delete again is false");
        assert((await s.list()).map((m) => m.id).join() === "c2", "the other credential stays");
      },
    },
    {
      name: "unknown ids read as undefined",
      async run() {
        const s = make();
        assert((await s.get("x")) === undefined && (await s.reveal("x")) === undefined, "undefined");
        assert((await s.list()).length === 0, "empty");
      },
    },
  ];
}
