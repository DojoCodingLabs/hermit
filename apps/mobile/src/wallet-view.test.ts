import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupAddress } from "./format.ts";
import { capMoney, ownAddress, qrCells, receiveQrText, transferParty, transferRow } from "./wallet-view.ts";

const ME = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const OTHER = "0x93354845030274Cd4bF1686AbD60aB28ec52E1A7";
// formatMoney's own locale rules are tested in packages/core; this stand-in keeps every digit and marks the locale and
// the decimals asked for: every row pads to 2, one format for the whole list, and keeps up to all 6.
const fmt = (m: { amount: bigint; asset: string }, locale: string, digits: number, min?: number) => `${m.amount}/${min}..${digits}@${locale} ${m.asset === "USDT" ? "USD₮" : m.asset}`;
const usdt = (amount: bigint) => ({ amount, asset: "USDT", network: "eip155:2201" });
const base = { txHash: "0x" + "ab".repeat(32), logIndex: 0, block: 76_000_000n, counterparty: OTHER, unknownSender: false };

test("HM-PAY-03: an incoming transfer from an unknown sender is labelled, with the exact amount in the locale's format", () => {
  const row = transferRow({ ...base, direction: "in", amount: usdt(1_234_567_891n), unknownSender: true, at: Date.UTC(2026, 10, 17, 15, 4) }, "es-419", fmt, "UTC");
  assert.equal(row.titleKey, "HM-PAY-03.in");
  assert.equal(row.amount, "+1234567891/2..6@es-419 USD₮");
  assert.equal(row.unknownSender, true);
  assert.equal(row.who, OTHER);
  assert.match(row.when!, /2026/);
  assert.equal(row.whenBlock, undefined);
});

test("HM-PAY-03: outgoing and to itself; a contact shows the user's own name, never text from the chain", () => {
  const out = transferRow({ ...base, direction: "out", amount: usdt(1n), contact: "Ana" }, "en", fmt, "UTC");
  assert.equal(out.titleKey, "HM-PAY-03.out");
  assert.equal(out.amount, "-1/2..6@en USD₮");
  assert.equal(out.who, "Ana");
  assert.equal(out.address, OTHER);
  const self = transferRow({ ...base, direction: "self", amount: usdt(5_000_000n), counterparty: ME }, "en", fmt, "UTC");
  assert.equal(self.titleKey, "HM-PAY-03.self");
  assert.equal(self.amount, "5000000/2..6@en USD₮");
  // No block time: the block number instead.
  assert.equal(self.when, undefined);
  assert.equal(self.whenBlock, "76,000,000");
});

test("HM-PAY-03: the asset is always USD₮; any other asset is refused, never shown as a balance", () => {
  assert.throws(() => transferRow({ ...base, direction: "in", amount: { amount: 1n, asset: "ETH", network: "eip155:2201" } }, "en", fmt, "UTC"));
  assert.throws(() => transferRow({ ...base, direction: "in", amount: { amount: 1n, asset: "USDT", network: "eip155:1" } }, "en", fmt, "UTC"));
});

test("HM-PAY-04: the QR holds the bare address (Q129), checked first", () => {
  assert.equal(receiveQrText(ME), ME);
  assert.throws(() => receiveQrText("0x123"));
  assert.throws(() => receiveQrText(ME + " "));
});

test("HM-PAY-04: the QR draws as rectangles inside a quiet zone of four modules", () => {
  const dark = [[true, true, false], [false, true, false], [true, false, true]];
  const q = { size: 3, version: 1, mask: 0, dark };
  const cells = qrCells(q);
  assert.equal(cells.side, q.size + 8);
  assert.deepEqual(cells.rects, [{ x: 4, y: 4, w: 2 }, { x: 5, y: 5, w: 1 }, { x: 4, y: 6, w: 1 }, { x: 6, y: 6, w: 1 }]);
  assert.ok(cells.rects.every((r) => r.x >= 4 && r.y >= 4 && r.x + r.w <= q.size + 4 && r.y < q.size + 4));
});

test("Polish round: caps and limits read as people say them, whole amounts with no decimals, cents only when there are any", () => {
  // Whole amounts ask for no decimals at all ("20 USD₮", "50 USD₮").
  assert.equal(capMoney(usdt(20_000_000n), "es-419", fmt), "20000000/0..0@es-419 USD₮");
  assert.equal(capMoney(usdt(0n), "en", fmt), "0/0..0@en USD₮");
  // Anything else shows its cents, and every digit it has ("20.50", "20.000001").
  assert.equal(capMoney(usdt(20_500_000n), "en", fmt), "20500000/2..6@en USD₮");
  assert.equal(capMoney(usdt(20_000_001n), "es-419", fmt), "20000001/2..6@es-419 USD₮");
  // A list of movements keeps two decimals on every row, so the column lines up.
  assert.match(transferRow({ ...base, direction: "out", amount: usdt(20_000_000n) }, "es-419", fmt).amount, /\/2\.\.6@/);
});

// Address poisoning: an attacker sends dust from a look-alike address that shares the real one's first and last
// characters, hoping the user copies it from the history. So an address with no saved name is never cut.
const LOOKALIKE = "0x93354845030274Cd4bF1686AbD60aB28ec5aE1A7";

test("security: an unknown sender's row shows the whole 42-character address, never cut", () => {
  const party = transferParty({ ...base, direction: "in", amount: usdt(1n), unknownSender: true });
  assert.equal(party.whole, true);
  assert.equal(party.address, OTHER);
  assert.equal(party.address.length, 42);
  assert.equal(party.name, undefined);
  // Unnamed but not flagged (an outgoing payment to a typed address): whole as well.
  assert.deepEqual(transferParty({ ...base, direction: "out", amount: usdt(1n) }), { address: OTHER, whole: true });
});

test("security: a saved payee's row leads with the name and may cut the address under it", () => {
  const party = transferParty({ ...base, direction: "out", amount: usdt(1n), contact: "Ana" });
  assert.equal(party.name, "Ana");
  assert.equal(party.whole, false);
  assert.equal(party.address, "0x9335…E1A7");
});

test("security: two look-alike addresses (same first 6 and last 4 characters) read differently in the history", () => {
  assert.equal(OTHER.slice(0, 6), LOOKALIKE.slice(0, 6));
  assert.equal(OTHER.slice(-4), LOOKALIKE.slice(-4));
  const real = transferParty({ ...base, direction: "in", amount: usdt(1n), counterparty: OTHER });
  const fake = transferParty({ ...base, direction: "in", amount: usdt(1n), counterparty: LOOKALIKE, unknownSender: true });
  assert.notEqual(real.address, fake.address);
  assert.equal(fake.address, LOOKALIKE);
});

test("security: the user's own address may be cut, with copy, on the wallet home", () => {
  assert.equal(ownAddress(ME), "0x9858…da94");
});

test("address poisoning, on screen: a whole address reads in groups of four, display only, never cut", () => {
  // Every character is there, grouped; the grouping is only how it's drawn.
  const party = transferParty({ ...base, direction: "in", amount: usdt(1n), unknownSender: true });
  assert.equal(groupAddress(party.address!).replace(/ /g, ""), OTHER);
  // The history and the latest movements draw an unnamed address only through WholeAddress, never a cut.
  const transfer = readFileSync(new URL("./components/Transfer.tsx", import.meta.url), "utf8");
  assert.match(transfer, /<WholeAddress address=\{party\.address\}/);
  assert.doesNotMatch(transfer, /middle\(/);
  // WholeAddress groups the address and isn't selectable (a selection would carry the spaces).
  const kit = readFileSync(new URL("./components/kit.tsx", import.meta.url), "utf8");
  const at = kit.indexOf("export function WholeAddress");
  const whole = kit.slice(at, kit.indexOf("\n}\n", at));
  assert.match(whole, /groupAddress\(address\)/);
  assert.doesNotMatch(whole, /selectable/);
});
