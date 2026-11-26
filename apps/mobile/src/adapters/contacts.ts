import type { ContactEntry, ContactsPermission, ContactsPort } from "@hermit/core";
import { HermitContacts } from "../../modules/hermit-contacts";

/**
 * PDR-028: the phone's contacts behind ContactsPort. Read only when a name the user said needs a lookup; the
 * entries live for that one call (never cached, never written to Hermit's database, never sent anywhere).
 */
export const phoneContacts: ContactsPort = {
  async permission(): Promise<ContactsPermission> {
    const r = await HermitContacts.getPermission();
    return r.granted ? "granted" : r.status === "undetermined" ? "not_asked" : "denied";
  },
  async entries(): Promise<ContactEntry[]> {
    const parsed: unknown = JSON.parse(await HermitContacts.entries());
    return Array.isArray(parsed) ? (parsed as ContactEntry[]) : [];
  },
};

/** For HM-SET-01 and HM-ONB-04: the reading without a prompt. */
export const contactsPermission = () => HermitContacts.getPermission();

/** The system prompt, only after the user taps Allow. True when granted. */
export async function requestContactsPermission(): Promise<boolean> {
  return (await HermitContacts.requestPermission()).granted;
}
