import { describe, expect, test } from "vitest";
import { FLOOR, floorCheck, floorView, type FloorFacts } from "../src/floor.ts";

// The S26 Ultra, the reference device (NFR-05): Android 16, arm64, 12 GB as Android reports it.
const s26: FloorFacts = {
  platform: "android",
  apiLevel: 36,
  abis: ["arm64-v8a"],
  totalRamBytes: 11_200_000_000,
  isLowRamDevice: false,
  dotprod: true,
  manufacturer: "samsung",
  model: "SM-S948B",
  soc: "SM8850",
};

describe("the device floor (US-ONB-06, NFR-05)", () => {
  test("the reference phone is supported", () => {
    expect(floorCheck(s26)).toEqual({ kind: "supported" });
  });

  test("the numbers are the packet's: Android 13 (API 33), arm64, 8 GB as Android reports it", () => {
    expect(FLOOR.minApiLevel).toBe(33);
    expect(FLOOR.abi).toBe("arm64-v8a");
    // An 8 GB phone reports 7.2 to 7.9 billion bytes (the kernel and modem carve-outs are not counted); a 6 GB one under 6.
    expect(FLOOR.minRamBytes).toBe(7_000_000_000);
  });

  test("an 8 GB phone as Android reports it passes; a 6 GB phone is below the floor", () => {
    expect(floorCheck({ ...s26, totalRamBytes: 7_350_000_000 }).kind).toBe("supported");
    expect(floorCheck({ ...s26, totalRamBytes: 5_800_000_000 })).toEqual({ kind: "below_floor", reasons: ["memory"], canOptIn: true });
  });

  test("Android 12 (API 32) is below the floor and can't opt in", () => {
    expect(floorCheck({ ...s26, apiLevel: 32 })).toEqual({ kind: "below_floor", reasons: ["android_version"], canOptIn: false });
    expect(floorCheck({ ...s26, apiLevel: 33 }).kind).toBe("supported");
  });

  test("a phone without arm64 can't run the model at all (QVAC ships arm64 only)", () => {
    expect(floorCheck({ ...s26, abis: ["armeabi-v7a", "armeabi"] })).toEqual({ kind: "below_floor", reasons: ["abi"], canOptIn: false });
    expect(floorCheck({ ...s26, abis: ["x86_64"] }).kind).toBe("below_floor");
  });

  test("CPUs without dot product and Android Go phones are below the floor, with the opt-in (PDR-025)", () => {
    expect(floorCheck({ ...s26, dotprod: false })).toEqual({ kind: "below_floor", reasons: ["no_dotprod"], canOptIn: true });
    expect(floorCheck({ ...s26, isLowRamDevice: true })).toEqual({ kind: "below_floor", reasons: ["low_ram_device"], canOptIn: true });
  });

  test("every reason is listed, hard ones first; one hard reason removes the opt-in", () => {
    const v = floorCheck({ ...s26, apiLevel: 30, abis: ["armeabi-v7a"], totalRamBytes: 3e9, dotprod: false });
    expect(v).toEqual({ kind: "below_floor", reasons: ["abi", "android_version", "memory", "no_dotprod"], canOptIn: false });
  });

  test("a fact the phone couldn't read never blocks: below the floor needs evidence", () => {
    expect(floorCheck({ platform: "android" })).toEqual({ kind: "supported" });
    expect(floorCheck({ ...s26, abis: [], apiLevel: undefined, totalRamBytes: undefined, dotprod: undefined }).kind).toBe("supported");
  });

  test("phones QVAC forces onto the CPU (Google Pixel, Tensor chips) are warned and may continue", () => {
    expect(floorCheck({ ...s26, manufacturer: "Google", model: "Pixel 9 Pro", soc: "Tensor G4" })).toEqual({ kind: "degraded", reasons: ["cpu_only"] });
    expect(floorCheck({ ...s26, manufacturer: "Google", model: "Pixel 8" }).kind).toBe("degraded");
    expect(floorCheck({ ...s26, soc: "GS201" }).kind).toBe("degraded");
    expect(floorCheck({ ...s26, manufacturer: "Google", model: "sdk_gphone64_arm64" }).kind).toBe("supported");
  });

  test("a slow calibration warns; it never blocks, since one slow moment can be memory pressure from other apps", () => {
    expect(floorCheck({ ...s26, measuredTokPerSec: 9.9 })).toEqual({ kind: "degraded", reasons: ["slow"] });
    expect(floorCheck({ ...s26, measuredTokPerSec: 0.23 })).toEqual({ kind: "degraded", reasons: ["slow"] });
    expect(floorCheck({ ...s26, measuredTokPerSec: FLOOR.slowTokPerSec }).kind).toBe("supported");
    expect(floorCheck({ ...s26, measuredTokPerSec: Number.NaN }).kind).toBe("supported");
  });

  test("below the floor wins over a slowness warning", () => {
    expect(floorCheck({ ...s26, totalRamBytes: 4e9, measuredTokPerSec: 2 }).kind).toBe("below_floor");
  });

  test("iOS is outside V1's floor and is not judged by Android rules", () => {
    expect(floorCheck({ platform: "ios", totalRamBytes: 6e9 })).toEqual({ kind: "supported" });
  });
});

describe("HM-ONB-05 (US-ONB-06)", () => {
  test("below the floor: one plain reason per line, what still works, and no download unless the user opts in", () => {
    const view = floorView({ kind: "below_floor", reasons: ["memory", "no_dotprod"], canOptIn: true }, { totalRamBytes: 5.8e9 });
    expect(view).toEqual({
      title: "HM-ONB-05.title",
      reasons: [
        { key: "HM-ONB-05.reason.memory", vars: { have: 5.8e9, need: 8e9 } },
        { key: "HM-ONB-05.reason.no_dotprod", vars: {} },
      ],
      stillWorks: "HM-ONB-05.stillWorks",
      warning: "HM-ONB-05.optInWarning",
      actions: ["download_anyway"],
    });
  });

  test("a hard reason offers no download at all", () => {
    const view = floorView({ kind: "below_floor", reasons: ["abi"], canOptIn: false }, {});
    expect(view.actions).toEqual([]);
    expect(view.warning).toBeUndefined();
    expect(view.stillWorks).toBe("HM-ONB-05.stillWorksNone");
  });

  test("the Android version line names the version the phone has when known", () => {
    expect(floorView({ kind: "below_floor", reasons: ["android_version"], canOptIn: false }, { apiLevel: 31 }).reasons).toEqual([
      { key: "HM-ONB-05.reason.android_version", vars: { need: 13 } },
    ]);
  });
});
