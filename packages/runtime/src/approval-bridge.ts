import type { ApprovalOutcome, ApprovalPort, ApprovalRequest } from "@hermit/core";

/**
 * Connects the agent's ApprovalPort to HM-APPR-01. The loop awaits `port.request`; the sheet
 * subscribes, shows `current`, and calls approve or deny. One sheet at a time; an expired or
 * replaced request resolves as expired, which the loop treats as a no (US-APPR-03).
 */
export interface ApprovalBridge {
  port: ApprovalPort;
  current(): ApprovalRequest | undefined;
  subscribe(listener: (req: ApprovalRequest | undefined) => void): () => void;
  /**
   * Called after the biometric prompt; `proof` is the HMAC from the biometric-gated key (FR-CAGE-03); `signature` is
   * the Keystore key's signature over `request.signed.message` for spend and credential (SL-37, FR-CAGE-06).
   */
  approve(requestId: string, opts: { biometric: boolean; proof?: string; signature?: string }): void;
  deny(requestId: string): void;
}

export function createApprovalBridge(
  now: () => number = Date.now,
  schedule: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
): ApprovalBridge {
  let pending: { req: ApprovalRequest; resolve(o: ApprovalOutcome): void } | undefined;
  const listeners = new Set<(r: ApprovalRequest | undefined) => void>();
  const notify = () => listeners.forEach((l) => l(pending?.req));
  const settle = (requestId: string, outcome: ApprovalOutcome) => {
    if (!pending || pending.req.id !== requestId) return; // a stale or repeated press does nothing
    const p = pending;
    pending = undefined;
    p.resolve(outcome);
    notify();
  };

  return {
    port: {
      request(req, signal) {
        if (pending) settle(pending.req.id, { kind: "expired" });
        // A stopped turn closes its sheet as denied (FR-LOOP-06); a sheet for an already stopped turn never opens.
        if (signal?.aborted) return Promise.resolve({ kind: "denied", reason: "stopped" });
        return new Promise<ApprovalOutcome>((resolve) => {
          pending = { req, resolve };
          notify();
          schedule(() => settle(req.id, { kind: "expired" }), Math.max(0, req.expiresAt - now()));
          signal?.addEventListener("abort", () => settle(req.id, { kind: "denied", reason: "stopped" }), { once: true });
        });
      },
    },
    current: () => pending?.req,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    approve(requestId, { biometric, proof, signature }) {
      const req = pending?.req;
      if (!req || req.id !== requestId) return;
      if (req.requireBiometric && !biometric) return settle(requestId, { kind: "denied", reason: "biometric required" });
      settle(requestId, { kind: "approved", biometric, argsHash: req.call.argsHash, ...(proof ? { proof } : {}), ...(signature ? { signature } : {}) });
    },
    deny(requestId) {
      settle(requestId, { kind: "denied" });
    },
  };
}
