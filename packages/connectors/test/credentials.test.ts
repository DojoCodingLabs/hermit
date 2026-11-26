import { describe, expect, it } from "vitest";
import { credentialStoreContract, MemoryCredentialStore, Secret } from "../src/index.ts";

describe("credential store contract (FR-CONN-03)", () => {
  // The same checks run against the Keystore-backed store in the app.
  for (const check of credentialStoreContract(() => new MemoryCredentialStore())) {
    it(check.name, check.run);
  }

  it("the contract catches a store that leaks the secret into the meta", async () => {
    class Leaky extends MemoryCredentialStore {
      override async list() {
        const metas = await super.list();
        return Promise.all(metas.map(async (m) => ({ ...m, account: JSON.stringify(await this.reveal(m.id)) })));
      }
    }
    const results = await Promise.allSettled(credentialStoreContract(() => new Leaky()).map((c) => c.run()));
    expect(results.some((r) => r.status === "rejected")).toBe(true);
  });
});

describe("Secret", () => {
  it("never prints its value", () => {
    const s = new Secret("tok_123");
    expect(String(s)).not.toContain("tok_123");
    expect(`${s}`).not.toContain("tok_123");
    expect(JSON.stringify({ s })).not.toContain("tok_123");
    expect(s.reveal()).toBe("tok_123");
  });
});
