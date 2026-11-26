// Preview only: replaces src/hermit-context.tsx. Same context shape, but the runtime is the sample Hermit in
// ../fake/hermit.ts and the approval bridge is the real one, fed a sample request when the shot calls for a sheet.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createApprovalBridge, type ApprovalBridge, type Hermit } from "@hermit/runtime";
import { fakeHermit } from "../fake/hermit";
import { sampleApproval } from "../fake/approvals";
import { scene } from "../scene";

type Status =
  | { kind: "starting" }
  | { kind: "ready"; hermit: Hermit; sessionId: string }
  | { kind: "not_wired"; slices: string[] }
  | { kind: "failed" }
  | { kind: "erase_pending"; done: number; total: number };

const Ctx = createContext<{ status: Status; approvals: ApprovalBridge; clearConversation(): Promise<void> } | null>(null);

export function HermitProvider({ children }: { children: ReactNode }) {
  const approvals = useMemo(() => {
    const bridge = createApprovalBridge(Date.now, () => undefined);
    const req = sampleApproval(scene.variant);
    if (req) void bridge.port.request(req);
    return bridge;
  }, []);
  const status = useMemo<Status>(() => ({ kind: "ready", hermit: fakeHermit as unknown as Hermit, sessionId: "s1" }), []);
  return <Ctx.Provider value={{ status, approvals, clearConversation: async () => {} }}>{children}</Ctx.Provider>;
}

export function useHermit() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHermit must be used inside HermitProvider");
  return v;
}
