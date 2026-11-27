import { Platform } from "react-native";
import { Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { HermitVault } from "../../modules/hermit-vault";
import { backupTargets, IOS_SECURE_STORE_SERVICES, migrationSummary } from "../backup-guard";

/**
 * #126 (non-negotiable 1): on iOS, Hermit's files stay out of iCloud and computer backups, and its plain Keychain items
 * move to a class that never leaves this phone. Android refuses backups already (`allowBackup` false): nothing runs there.
 * Neither call throws: a failure is logged and tried again at the next launch, and never stops Hermit from starting.
 */

let dbPath: string | undefined;

/** Flags the documents folder, the model and QVAC folders and the database as excluded from backup. */
export async function keepOutOfBackups(database?: string): Promise<void> {
  if (Platform.OS !== "ios") return;
  if (database) dbPath = database;
  try {
    const flags = await HermitVault.excludeFromBackup(backupTargets(Paths.document.uri, dbPath));
    const missed = Object.entries(flags).filter(([, excluded]) => !excluded).map(([path]) => path.split("/").slice(-2).join("/"));
    console.log(`[hermit:backup] excluded ${Object.keys(flags).length - missed.length} paths${missed.length ? `, not ${missed.join(", ")}` : ""}`);
  } catch (err) {
    console.log(`[hermit:backup] exclude failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** At launch: every plain SecureStore item moves to WhenUnlockedThisDeviceOnly in place. Gated ones move in ./secure. */
export async function moveKeychainToThisDevice(): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const s = migrationSummary(await HermitVault.keychainToThisDevice(IOS_SECURE_STORE_SERVICES));
    // Only the class changed, in place; each moved item must still read back through SecureStore.
    const unreadable: string[] = [];
    for (const key of s.moved) if ((await SecureStore.getItemAsync(key).catch(() => null)) === null) unreadable.push(key);
    console.log(
      `[hermit:keychain] this device only: moved ${s.moved.length}, already ${s.kept.length}` +
        `${s.failed.length ? `, not yet ${s.failed.join(", ")}` : ""}${unreadable.length ? `, unreadable ${unreadable.join(", ")}` : ""}`,
    );
  } catch (err) {
    console.log(`[hermit:keychain] move failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
