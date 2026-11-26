// The night shift's device readings (SL-24, FR-NIGHT-01, NFR-04), mapped from the native module. Pure: tested
// under Node with node --test. Anything that couldn't be read fails closed, so the night shift waits.

export interface NightDeviceState {
  charging: boolean;
  batteryPercent: number;
  thermalStatus: number;
  screenOn: boolean;
  network: "wifi" | "cellular" | "none";
}

export function nightDeviceState(
  power: { charging: boolean; batteryPercent: number; screenOn: boolean } | undefined,
  thermal: { status: number } | undefined,
  network: "wifi" | "cellular" | "none",
): NightDeviceState {
  const battery = power && Number.isFinite(power.batteryPercent) && power.batteryPercent >= 0 && power.batteryPercent <= 100 ? power.batteryPercent : Number.NaN;
  return {
    charging: power?.charging === true,
    batteryPercent: battery,
    thermalStatus: thermal && Number.isFinite(thermal.status) && thermal.status >= 0 ? thermal.status : Number.NaN,
    screenOn: power ? power.screenOn !== false : true,
    network,
  };
}
