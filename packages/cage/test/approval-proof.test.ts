import { expect, test } from "vitest";
import { approvalProof, verifyApprovalProof } from "../src/approval-proof.ts";

const key = new Uint8Array(32).fill(5);
const hash = "a".repeat(64);

test("approval proof verifies for the same hash and request", () => {
  const proof = approvalProof(key, hash, "req-1");
  expect(proof).toMatch(/^[0-9a-f]{64}$/);
  expect(verifyApprovalProof(key, hash, "req-1", proof)).toBe(true);
});

test("approval proof fails for a different hash", () => {
  const proof = approvalProof(key, hash, "req-1");
  expect(verifyApprovalProof(key, "b".repeat(64), "req-1", proof)).toBe(false);
  expect(verifyApprovalProof(key, hash, "req-2", proof)).toBe(false);
  expect(verifyApprovalProof(key, hash, "req-1", "zz")).toBe(false);
});
