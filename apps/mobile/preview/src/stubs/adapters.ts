// Preview only: stands in for apps/mobile/src/adapters/* (native modules, Keystore, QVAC, the phone's settings).
// Every function answers with what a healthy Galaxy S26 on Wi-Fi would report; nothing reaches a device.
import { permissionRow, remindersRow } from "@hermit/runtime";
import { scene } from "../scene";

const ok = <T>(v: T) => () => Promise.resolve(v);
const off = () => () => {};

export class NotWiredError extends Error {
  constructor(readonly slices: string[]) {
    super(`not wired: ${slices.join(", ")}`);
    this.name = "NotWiredError";
  }
}
export class ApprovalSignError extends Error {
  constructor(readonly code: string) {
    super(`Approval not signed: ${code}`);
    this.name = "ApprovalSignError";
  }
}

// Runtime wiring (unused: the preview provides its own Hermit).
export const createPorts = ok({});
export const devicePlan = ok(undefined);
export const loadPlan = ok(undefined);
export const allowedCpus = () => undefined;
export const setOutboundSink = () => {};
export const startCapture = ok(undefined);
export const startNightScheduler = () => () => {};
export const liveHermit = () => undefined;
export const nightErasing = () => false;
export const releaseModel = ok(undefined);
export const forgetBotCaches = ok(undefined);
export const setCacheOwners = () => {};
export const pendingErase = ok(undefined);
export const countedFetch = (...a: Parameters<typeof fetch>) => fetch(...a);
export const MISSING: unknown[] = [];

// Device and model.
export const deviceFacts = ok({ network: "wifi" as const, freeBytes: 96 * 1024 ** 3 });
export const phoneFacts = deviceFacts;
// HM-ONB-05's shot ("below") is an older phone: under 3 GB of RAM and no dot product.
export const floorFacts = ok(scene.variant === "below"
  ? { platform: "android" as const, apiLevel: 29, abis: ["arm64-v8a", "armeabi-v7a"], totalRamBytes: 2.8 * 1024 ** 3, isLowRamDevice: false, dotprod: false, manufacturer: "samsung", model: "SM-A105M", soc: "Exynos 7884" }
  : { platform: "android" as const, apiLevel: 36, abis: ["arm64-v8a"], totalRamBytes: 11.2 * 1024 ** 3, isLowRamDevice: false, dotprod: true, manufacturer: "samsung", model: "SM-S942B", soc: "SM8850" });
export const nightConditions = ok({ charging: true, batteryLevel: 0.82, network: "wifi", screenOn: false, idleMinutes: 45 });
export const onReconnect = off;
export const pauseDownloadWhenLeaving = off;
export const openStorageSettings = ok(undefined);
export const modelFile = () => ({ exists: false, uri: "file:///model.gguf", size: 0 });
export const verifiedSha256 = () => undefined;
export const modelReady = () => scene.variant !== "fresh";
export const partialModel = () => (scene.variant === "progress" ? 1_240_000_000 : 0);
export function downloadModel(_url: string, from: number, onProgress: (n: number) => void) {
  // The download screen shows its progress state: a slice arrives, then the stream stays open.
  setTimeout(() => onProgress(from + 1_240_000_000), 50);
  return new Promise(() => {});
}
export function onModelLoading(_l: (loading: boolean) => void) {
  return () => {};
}
export const checkModelUpdate = ok(undefined);
export const modelUpdateState = () => ({ kind: "idle" });
export const onModelUpdate = off;
export const qvacEngine = {};

// Permissions (HM-ONB-03, HM-SET-01).
export const requestNotificationAccess = ok(true);
export const requestCalendarAccess = ok(true);
export const calendarAccessGranted = () => Promise.resolve(scene.variant !== "forbidden");
export const requestContactsPermission = ok(true);
export const requestReminderPermission = ok(true);
export const setUpApprovals = ok(true);
export const notificationAccessEnabled = () => scene.variant !== "forbidden";
export const openNotificationAccessSettings = ok(undefined);
export const openAppSettings = ok(undefined);
export const openBatterySettings = () => true;
export async function readPermissions() {
  return [
    permissionRow("notifications", { kind: "special", enabled: true }),
    permissionRow("calendar", { kind: "prompt", status: "granted", canAskAgain: true }),
    permissionRow("contacts", { kind: "prompt", status: "denied", canAskAgain: false }),
    remindersRow({ kind: "prompt", status: "granted", canAskAgain: true }, { kind: "special", enabled: false }),
    permissionRow("fingerprint", { kind: "special", enabled: true }),
    permissionRow("microphone", { kind: "not_used" }),
    permissionRow("autofill", { kind: "special", enabled: false }),
  ];
}
export const actOnPermission = ok(undefined);

// App lock and fingerprint.
export const appLockEnabled = () => scene.variant === "locked";
export const saveAppLock = ok(undefined);
// The copy keeps its default biometric name: an Android phone's fingerprint.
export const applyBiometricName = ok(undefined);
export const phoneSecurity = ok("biometric" as const);
// The lock screen's shot waits at its own prompt, as on the phone before the fingerprint.
export const confirmOwner = () => (scene.variant === "locked" ? new Promise<boolean>(() => {}) : Promise.resolve(true));
export const onPrompt = off;
export const trackPrompt = <T>(run: () => Promise<T>) => run();
export const confirmWithFingerprint = ok({ kind: "ok" });
export const authenticate = () => new Promise(() => {});
export const signLogin = ok("3045");
export const approvalKeyPort = {};

// Vault and autofill.
export const clearPendingCopy = ok(undefined);
export const copySensitive = ok(true);
export const secureScreen = ok(true);
// HM-VAULT-03's preview and done shots: a picked Chrome export (the fake vault answers with its preview).
const importing = scene.variant === "preview" || scene.variant === "done";
export const pickCsvFile = ok(importing ? { kind: "picked" as const, file: { uri: "content://downloads/1", name: "Chrome Passwords.csv", size: 4_812, canDelete: true } } : { kind: "cancelled" as const });
export const readCsvFile = ok(importing ? { kind: "bytes" as const, bytes: new Uint8Array(1) } : { kind: "unreadable" as const });
export const deleteCsvFile = ok(true);
export const autofillSelected = () => false;
export const openAutofillSettings = () => {};
export function pendingFill(id: string) {
  return {
    kind: "request" as const,
    request: {
      id, kind: "form", packageName: "com.mercadolibre", certDigests: ["ab12"], web: [], origin: "", appLabel: "Mercado Libre",
      fields: [
        { id: "f1", hint: "name", autofillHints: ["personName"] },
        { id: "f2", hint: "email", autofillHints: ["emailAddress"] },
        { id: "f3", hint: "phone", autofillHints: ["phone"] },
      ],
    },
  };
}
export const completeFill = () => true;
export const cancelFill = () => {};

// Night shift.
export const backgroundStatus = () => ({ supported: true, scheduled: true, ignoringBatteryOptimizations: false, notificationsAllowed: true, lastStartedAt: Date.now() - 8 * 3600_000 });
export const syncNightSchedule = ok(undefined);
export const wakeNightShift = ok(undefined);

// Erase (HM-SET-03).
export const confirmErase = ok(true);
export const eraseEverything = () => new Promise(() => {});
export const phoneHasLock = ok(true);
export const walletBalance = ok("127.45 USD₮");

// Browser (HM-WEB-02).
export const browserAvailable = () => true;
export const browserMultiProfile = () => true;
export const browserRecorder = () => true;
export const siteProfile = (origin: string) => `site_${origin.length}`;
export const countBrowserRequest = () => {};
export const clearSiteData = ok(true);

// Wallet.
export const copyAddress = ok(true);
export const copyLogValue = ok(true);
export const walletBundleAvailable = () => false;
export const appVersion = () => "0.1.0-preview.1";
export const startWalletWorklet = () => ({});
