import assert from "node:assert/strict";
import { test } from "node:test";
import { nightDeviceState } from "./night-device.ts";

test("readings map to the night shift's guards", () => {
  assert.deepEqual(
    nightDeviceState({ charging: true, batteryPercent: 82, screenOn: false }, { status: 1 }, "wifi"),
    { charging: true, batteryPercent: 82, thermalStatus: 1, screenOn: false, network: "wifi" },
  );
});

test("a reading that failed or is unsupported fails closed", () => {
  const unknown = nightDeviceState(undefined, undefined, "none");
  assert.equal(unknown.charging, false);
  assert.equal(unknown.screenOn, true);
  assert.ok(Number.isNaN(unknown.batteryPercent));
  assert.ok(Number.isNaN(unknown.thermalStatus));
  const negative = nightDeviceState({ charging: true, batteryPercent: -2147483648, screenOn: false }, { status: 0 }, "wifi");
  assert.ok(Number.isNaN(negative.batteryPercent));
});
