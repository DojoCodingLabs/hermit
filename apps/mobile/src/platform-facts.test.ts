/// <reference types="node" />
// The platform the runtime plan and the floor check read, and the iOS thermal state on Android's scale. Made-up facts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { byteCount, hardwareFactsFor, hardwarePlatform, thermalFromNative } from "./platform-facts.ts";

const native = {
  clusters: [],
  logicalCores: 6,
  totalRamBytes: 8 * 1024 ** 3,
  isLowRamDevice: false,
  soc: "iPhone99,1",
  model: "iPhone99,1",
  dotprod: true,
  i8mm: true,
  sve2: false,
  sme2: false,
};

test("the platform comes from the OS, never a hard-coded android", () => {
  assert.equal(hardwarePlatform("ios"), "ios");
  assert.equal(hardwarePlatform("android"), "android");
});

test("an iPhone's facts say ios and carry its performance cores", () => {
  const f = hardwareFactsFor("ios", { ...native, performanceCores: 2 }, undefined);
  assert.equal(f.platform, "ios");
  assert.equal(f.performanceCores, 2);
  assert.deepEqual(f.clusters, []);
  assert.equal("allowedCpus" in f, false);
  assert.deepEqual(f.cpuFeatures, { dotprod: true, i8mm: true, sve2: false, sme2: false });
});

test("an Android phone's facts stay as they were", () => {
  const f = hardwareFactsFor("android", { ...native, clusters: [{ cpus: [0, 1], maxFreqKHz: 3_000_000 }] }, [0, 1]);
  assert.equal(f.platform, "android");
  assert.deepEqual(f.allowedCpus, [0, 1]);
  assert.equal("performanceCores" in f, false);
});

test("iOS thermal states map onto Android's THERMAL_STATUS scale", () => {
  // ProcessInfo.ThermalState: nominal 0, fair 1, serious 2, critical 3.
  assert.equal(thermalFromNative("ios", { status: 0, headroom: Number.NaN, powerSave: false }).status, 0);
  assert.equal(thermalFromNative("ios", { status: 1, headroom: Number.NaN, powerSave: false }).status, 1);
  assert.equal(thermalFromNative("ios", { status: 2, headroom: Number.NaN, powerSave: false }).status, 3);
  assert.equal(thermalFromNative("ios", { status: 3, headroom: Number.NaN, powerSave: true }).status, 4);
  assert.equal(thermalFromNative("ios", { status: 3, headroom: Number.NaN, powerSave: true }).powerSave, true);
});

test("an unknown iOS thermal state is unknown, not cool", () => {
  assert.ok(Number.isNaN(thermalFromNative("ios", { status: 7, headroom: Number.NaN, powerSave: false }).status));
  assert.ok(Number.isNaN(thermalFromNative("ios", { status: -1, headroom: Number.NaN, powerSave: false }).status));
});

test("Android thermal statuses pass through unchanged", () => {
  assert.deepEqual(thermalFromNative("android", { status: 2, headroom: 0.4, powerSave: false }), { status: 2, headroom: 0.4, powerSave: false });
});

test("byte counts from native code are plain numbers, even when iOS hands back a BigInt", () => {
  assert.equal(byteCount(123_456_789n), 123_456_789);
  assert.equal(byteCount(529_000_000), 529_000_000);
  assert.equal(typeof byteCount(0n), "number");
  assert.equal(byteCount(5_000_000_000n) - 1, 4_999_999_999);
});
