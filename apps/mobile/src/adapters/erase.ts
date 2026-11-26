import { deleteCache } from "@qvac/sdk";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import { Directory, File, Paths } from "expo-file-system";
import { clearTables, erasePlan, runErase, SECRET_KEYS, type EraseJournal, type EraseJournalPort, type EraseResult, type EraseStep } from "@hermit/core";
import { deleteCaptureQueue, stopCapture } from "./messages";
import { deleteDatabase, encryptedSql } from "./op-sqlite";
import { deleteSecret, existingPlainSecret } from "./secure";
import { openDatabase, releaseModel } from "./index";
import { beginNightErase, stopNightShiftForErase } from "./night";
import { destroyVaultKey } from "./vault";
import { deleteAllCredentials } from "./credentials";
import { destroyApprovalKey } from "./approval-key";
import { destroyWalletKey, walletBalanceForErase } from "./wallet";
import { currentLocale, translate } from "../i18n";
import { HermitVault } from "../../modules/hermit-vault";

/**
 * SL-26 (US-SET-03, HM-SET-03): runs the pure erase plan from @hermit/core on the phone. Each step is
 * idempotent; the journal lives in the app's files directory, outside everything the plan deletes.
 */

const JOURNAL = "hermit-erase.json";

/**
 * Written to a temporary file, then moved into place, so a kill mid-write leaves one readable copy.
 * An unreadable journal still means an erase was under way: it restarts from the first step, which is safe.
 */
export const eraseJournal: EraseJournalPort = {
  async read() {
    for (const name of [JOURNAL, `${JOURNAL}.tmp`]) {
      const f = new File(Paths.document, name);
      if (!f.exists) continue;
      try {
        return JSON.parse(f.textSync()) as EraseJournal;
      } catch {
        return { version: 1, startedAt: 0, done: [] };
      }
    }
    return undefined;
  },
  async write(journal) {
    const tmp = new File(Paths.document, `${JOURNAL}.tmp`);
    const final = new File(Paths.document, JOURNAL);
    if (tmp.exists) tmp.delete();
    tmp.create();
    tmp.write(JSON.stringify(journal));
    if (final.exists) final.delete();
    tmp.move(final);
  },
  async clear() {
    for (const name of [JOURNAL, `${JOURNAL}.tmp`]) {
      const f = new File(Paths.document, name);
      if (f.exists) f.delete();
    }
  },
};

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function execute(step: EraseStep): Promise<void> {
  switch (step.kind) {
    case "stop_capture":
      return stopCapture();
    case "stop_night_shift":
      return stopNightShiftForErase();
    case "release_model":
      return releaseModel();
    case "cancel_notifications":
      // Scheduled reminder alarms, and any reminder already showing in the shade.
      await Notifications.cancelAllScheduledNotificationsAsync();
      await Notifications.dismissAllNotificationsAsync();
      return;
    case "delete_kv_caches":
      // Every cache QVAC keeps, named ones included (they encode conversation content, Q35).
      if (!(await deleteCache({ all: true })).success) throw new Error("QVAC kept its caches.");
      return;
    case "clear_tables": {
      // Resuming at launch nothing is open: open it with its key, if the key (and so the file) is still there.
      let sql = openDatabase();
      if (!sql) {
        const key = await existingPlainSecret(SECRET_KEYS.db);
        if (!key) return;
        sql = encryptedSql(hex(key));
      }
      return clearTables(sql, step.tables);
    }
    case "delete_database":
      return deleteDatabase();
    case "delete_capture_queue":
      return deleteCaptureQueue();
    case "delete_model_files": {
      const models = new Directory(Paths.document, "models");
      if (models.exists) models.delete();
      return;
    }
    case "destroy_vault_key":
      // SL-33: a copied secret still waiting for its timer goes too, then the wrapped key and its Keystore key.
      await HermitVault.clearPendingCopy().catch(() => {});
      return destroyVaultKey();
    case "destroy_approval_key":
      // SL-37: the Keystore key that signs money and password approvals. Non-exportable, so it is only ever destroyed.
      return destroyApprovalKey();
    case "destroy_wallet_key":
      // SL-38: the wallet worklet stops (dropping any open account), then the wrapped wallet key and its Keystore key.
      // Without them the sealed seed in the wallet record (deleted with the secrets) can never open.
      return destroyWalletKey();
    case "delete_native_prefs":
      // SL-20: the autofill service's trusted origins and last request live in their own preferences file.
      return HermitVault.deletePreferences(step.names);
    case "delete_credentials":
      // SL-54: every MCP server token and connector token, deleted on the phone (no network: the erase works offline).
      return deleteAllCredentials();
    case "delete_secret":
      return deleteSecret(step.key);
  }
}

/** Steps finished by an erase that was interrupted, or undefined when none is pending. */
export async function pendingErase(): Promise<{ done: number; total: number } | undefined> {
  const journal = await eraseJournal.read();
  if (!journal) return undefined;
  const plan = erasePlan();
  return { done: plan.filter((s) => journal.done.includes(s.id)).length, total: plan.length };
}

/** Runs (or resumes) the whole erase. */
export function eraseEverything(onProgress: (done: number, total: number) => void): Promise<EraseResult> {
  // Before the journal exists: a night pass running now stops before its next write.
  beginNightErase();
  return runErase(erasePlan(), execute, eraseJournal, { now: () => Date.now(), onProgress });
}

/**
 * The fingerprint before the erase. Device PIN fallback is allowed: unlike an approval, this only destroys
 * the user's own data and already needs the typed word, and a changed fingerprint must not trap someone
 * who wants to leave. A phone with no lock at all has nothing to check: the typed word is the confirmation.
 */
export async function confirmErase(prompt: string): Promise<boolean> {
  if ((await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.NONE) return true;
  const auth = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, disableDeviceFallback: false });
  return auth.success;
}

/** Whether the phone has any lock to confirm with (HM-SET-03 says so when it has none). */
export async function phoneHasLock(): Promise<boolean> {
  return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
}

/** SL-38: the wallet's balance, formatted, when it holds money or can't be read (US-SET-03 warns first). */
export async function walletBalance(): Promise<string | undefined> {
  const locale = currentLocale();
  return walletBalanceForErase(locale, translate(locale, "HM-SET-03.walletUnknown"));
}
