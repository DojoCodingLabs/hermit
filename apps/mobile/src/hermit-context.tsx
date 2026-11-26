import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createApprovalBridge, createHermit, type ApprovalBridge, type Hermit } from "@hermit/runtime";
import { PROFILES, profileForPlan } from "@hermit/model";
import { createPorts, devicePlan, NotWiredError, setOutboundSink, startCapture, startNightScheduler } from "./adapters";
import { pendingErase } from "./adapters/erase";

type Status =
  | { kind: "starting" }
  | { kind: "ready"; hermit: Hermit; sessionId: string }
  | { kind: "not_wired"; slices: string[] }
  | { kind: "failed" }
  /** An erase was interrupted (HM-SET-03): the app resumes it before anything else. */
  | { kind: "erase_pending"; done: number; total: number };

const Ctx = createContext<{ status: Status; approvals: ApprovalBridge; clearConversation(): Promise<void> } | null>(null);

export function HermitProvider({ children }: { children: ReactNode }) {
  const approvals = useMemo(() => createApprovalBridge(), []);
  const [status, setStatus] = useState<Status>({ kind: "starting" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // SL-26: an erase interrupted by a kill finishes before anything opens the database or captures again.
        const erase = await pendingErase();
        if (erase) {
          if (alive) setStatus({ kind: "erase_pending", ...erase });
          return;
        }
        console.log("[hermit] creating ports");
        const ports = await createPorts(approvals.port);
        console.log("[hermit] ports ready");
        // The shipped profile, tuned to this phone (thinking budget, fast route on slow tiers).
        const plan = await devicePlan();
        const hermit = createHermit(ports, plan ? profileForPlan(PROFILES[0]!, plan) : PROFILES[0]!);
        await hermit.init();
        console.log("[hermit] schema migrated");
        // US-CHAT-07: pick up the kept conversation, or start the first one.
        const sessionId = await hermit.resumeSession();
        // FR-PRIV-02: hosts counted by the fetch wrapper go to the encrypted database from here on.
        setOutboundSink((url) => hermit.hosts.record(url));
        // FR-MSG-02: drain what arrived while the app was closed, then capture live.
        await startCapture(hermit.messages).catch(() => {});
        // Q69: keeps the background wake in line with the settings; the in-app timer is the fallback while alive.
        startNightScheduler(hermit);
        if (alive) setStatus({ kind: "ready", hermit, sessionId });
      } catch (err) {
        console.warn("[hermit] runtime failed to start:", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
        if (!alive) return;
        setStatus(err instanceof NotWiredError ? { kind: "not_wired", slices: err.slices } : { kind: "failed" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [approvals]);

  // "Clear conversation": the history goes and the chat continues in a fresh session (memories and the log stay).
  const clearConversation = useCallback(async () => {
    if (status.kind !== "ready") return;
    const sessionId = await status.hermit.clearConversation();
    setStatus({ ...status, sessionId });
  }, [status]);

  return <Ctx.Provider value={{ status, approvals, clearConversation }}>{children}</Ctx.Provider>;
}

export function useHermit() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHermit must be used inside HermitProvider");
  return v;
}
