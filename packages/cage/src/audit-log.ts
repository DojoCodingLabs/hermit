import type { SignerPort, SqlPort } from "@hermit/core";
import { appendEntry, clearedGenesis, verifyChain, type AuditEntry, type AuditInput } from "./audit.ts";

export interface AuditLog {
  migrate(): Promise<void>;
  append(input: AuditInput): Promise<AuditEntry>;
  entries(): Promise<AuditEntry[]>;
  verify(publicKey: Uint8Array): Promise<ReturnType<typeof verifyChain>>;
  /**
   * FR-ACT-04, PDR-012: removes every entry and starts a new chain whose only entry records the clear,
   * the old head hash and the count, in one transaction. The caller gates it (fingerprint, intact chain).
   */
  clear(input: Pick<AuditInput, "ts" | "sessionId">): Promise<AuditEntry>;
}

type Row = {
  seq: number; ts: number; session_id: string; event: AuditEntry["event"]; skill: string | null;
  args_hash: string | null; decision: AuditEntry["decision"] | null; outcome: AuditEntry["outcome"] | null;
  cleared_count?: number | null;
  reason?: string | null;
  payload_hash?: string | null;
  approval_sig?: string | null;
  bot_id?: string | null;
  prev_hash: string; hash: string; sig: string;
};

const fromRow = (r: Row): AuditEntry => {
  const e: AuditEntry = { seq: r.seq, ts: r.ts, sessionId: r.session_id, event: r.event, prevHash: r.prev_hash, hash: r.hash, sig: r.sig };
  if (r.skill !== null) e.skill = r.skill;
  if (r.args_hash !== null) e.argsHash = r.args_hash;
  if (r.decision !== null) e.decision = r.decision;
  if (r.outcome !== null) e.outcome = r.outcome;
  if (r.cleared_count !== null && r.cleared_count !== undefined) e.clearedCount = r.cleared_count;
  if (r.reason !== null && r.reason !== undefined) e.reason = r.reason;
  if (r.payload_hash !== null && r.payload_hash !== undefined) e.payloadHash = r.payload_hash;
  if (r.approval_sig !== null && r.approval_sig !== undefined) e.approvalSig = r.approval_sig;
  if (r.bot_id !== null && r.bot_id !== undefined) e.bot = r.bot_id;
  return e;
};

const INSERT =
  "INSERT INTO audit (seq, ts, session_id, event, skill, args_hash, decision, outcome, cleared_count, reason, payload_hash, approval_sig, bot_id, prev_hash, hash, sig) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
const values = (e: AuditEntry) => [
  e.seq, e.ts, e.sessionId, e.event, e.skill ?? null, e.argsHash ?? null, e.decision ?? null, e.outcome ?? null, e.clearedCount ?? null, e.reason ?? null,
  e.payloadHash ?? null, e.approvalSig ?? null, e.bot ?? null, e.prevHash, e.hash, e.sig,
];

/** The signed audit chain, persisted in SQLite (op-sqlite on the phone, node:sqlite in tests). */
export function createAuditLog(sql: SqlPort, signer: SignerPort): AuditLog {
  const all = async () => (await sql.query<Row>("SELECT * FROM audit ORDER BY seq")).map(fromRow);
  return {
    async migrate() {
      await sql.exec(`CREATE TABLE IF NOT EXISTS audit (
        seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, session_id TEXT NOT NULL, event TEXT NOT NULL,
        skill TEXT, args_hash TEXT, decision TEXT, outcome TEXT,
        prev_hash TEXT NOT NULL, hash TEXT NOT NULL, sig TEXT NOT NULL)`);
      const cols = await sql.query<{ name: string }>("PRAGMA table_info(audit)");
      if (!cols.some((c) => c.name === "cleared_count")) await sql.exec("ALTER TABLE audit ADD COLUMN cleared_count INTEGER");
      if (!cols.some((c) => c.name === "reason")) await sql.exec("ALTER TABLE audit ADD COLUMN reason TEXT");
      if (!cols.some((c) => c.name === "payload_hash")) await sql.exec("ALTER TABLE audit ADD COLUMN payload_hash TEXT");
      if (!cols.some((c) => c.name === "approval_sig")) await sql.exec("ALTER TABLE audit ADD COLUMN approval_sig TEXT");
      if (!cols.some((c) => c.name === "bot_id")) await sql.exec("ALTER TABLE audit ADD COLUMN bot_id TEXT");
    },
    async append(input) {
      return sql.transaction(async (tx) => {
        const [last] = await tx.query<Row>("SELECT * FROM audit ORDER BY seq DESC LIMIT 1");
        const e = await appendEntry(last ? fromRow(last) : null, input, signer);
        await tx.exec(INSERT, values(e));
        return e;
      });
    },
    async clear(input) {
      return sql.transaction(async (tx) => {
        const [last] = await tx.query<Row>("SELECT * FROM audit ORDER BY seq DESC LIMIT 1");
        const [{ n }] = (await tx.query<{ n: number }>("SELECT COUNT(*) AS n FROM audit")) as [{ n: number }];
        const genesis = await clearedGenesis(last ? fromRow(last) : null, n, input, signer);
        await tx.exec("DELETE FROM audit");
        await tx.exec(INSERT, values(genesis));
        return genesis;
      });
    },
    entries: all,
    async verify(publicKey) {
      return verifyChain(await all(), publicKey);
    },
  };
}
