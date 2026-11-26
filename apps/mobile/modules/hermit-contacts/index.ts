import { NativeModule, requireNativeModule } from "expo";

export interface ContactsPermissionResponse {
  status: "granted" | "denied" | "undetermined";
  granted: boolean;
  canAskAgain: boolean;
}

declare class HermitContactsNative extends NativeModule {
  getPermission(): Promise<ContactsPermissionResponse>;
  requestPermission(): Promise<ContactsPermissionResponse>;
  /** JSON array of ContactEntry (@hermit/core). */
  entries(): Promise<string>;
}

/** The phone's contacts for one lookup (PDR-028). Android only. */
export const HermitContacts = requireNativeModule<HermitContactsNative>("HermitContacts");
