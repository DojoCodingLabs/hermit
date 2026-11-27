import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { keychain } from "./secure";

/**
 * US-SET-09: the app lock's switch and its unlock. The switch lives in SecureStore, not the database,
 * so the very first frame already knows whether to lock (the database opens later). It holds no secret.
 */
const KEY = "hermit.applock.v1";

export function appLockEnabled(): boolean {
  try {
    return SecureStore.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export async function saveAppLock(on: boolean): Promise<void> {
  if (on) await SecureStore.setItemAsync(KEY, "1", keychain());
  else await SecureStore.deleteItemAsync(KEY);
}

/** "biometric": a fingerprint is enrolled; "device": only a PIN, pattern or password; "none": no screen lock at all. */
export async function phoneSecurity(): Promise<"biometric" | "device" | "none"> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) return "none";
  return (await LocalAuthentication.isEnrolledAsync()) ? "biometric" : "device";
}

/**
 * The unlock: the fingerprint, with the phone's own PIN as the fallback (it is the owner's too), so a
 * wet finger never locks someone out of their own Hermit.
 */
export async function confirmOwner(prompt: string): Promise<boolean> {
  const result = await trackPrompt(() => LocalAuthentication.authenticateAsync({ promptMessage: prompt, disableDeviceFallback: false }));
  return result.success;
}

/** Hermit's own fingerprint prompts, so the lock never treats the prompt's trip away as the user leaving. */
const promptListeners = new Set<(open: boolean) => void>();
export function onPrompt(listener: (open: boolean) => void): () => void {
  promptListeners.add(listener);
  return () => void promptListeners.delete(listener);
}

export async function trackPrompt<T>(run: () => Promise<T>): Promise<T> {
  for (const l of promptListeners) l(true);
  try {
    return await run();
  } finally {
    for (const l of promptListeners) l(false);
  }
}
