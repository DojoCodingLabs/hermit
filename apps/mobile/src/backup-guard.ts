/**
 * #126 (non-negotiable 1): on iOS, Hermit's files and Keychain items stay out of iCloud and computer backups. Android
 * already refuses backups (`allowBackup` false), so nothing here changes it. These are the pure rules; the adapter
 * (./adapters/backup.ts) runs them through the HermitVault module and expo-secure-store.
 */

/**
 * SecureStore options for a write. On iOS the item gets a ThisDeviceOnly accessibility (`accessible` is
 * `SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY`), so it never moves to another phone through a backup. On Android the
 * options are returned untouched.
 */
export function deviceOnly<T extends object>(platform: string, accessible: number, options?: T): (T & { keychainAccessible?: number }) | undefined {
  if (platform !== "ios") return options;
  return { ...(options ?? ({} as T)), keychainAccessible: accessible };
}

/**
 * iOS's protection classes (`kSecAttrAccessible`, read back as `pdmn`) that never leave this phone: when unlocked,
 * after first unlock, always, and when a passcode is set, each ThisDeviceOnly.
 */
const THIS_DEVICE_ONLY = new Set(["aku", "cku", "dku", "akpu"]);

/** The class keeps the item on this phone. `null` is no item; `"unknown"` is an item iOS wouldn't describe. */
export function isThisDeviceOnly(pdmn: string | null | undefined): boolean {
  return pdmn !== null && pdmn !== undefined && THIS_DEVICE_ONLY.has(pdmn);
}

/**
 * A biometric-gated item is moved (deleted and added again with a ThisDeviceOnly class) only right after the user's own
 * authenticated read, and only when iOS says it can migrate. Absent or unknown: it is left alone, since deleting what
 * can't be checked could lose it.
 */
export function gatedNeedsMove(pdmn: string | null | undefined): boolean {
  return pdmn !== null && pdmn !== undefined && pdmn !== "unknown" && !THIS_DEVICE_ONLY.has(pdmn);
}

/**
 * The Keychain services expo-secure-store writes plain items under: `app:no-auth` today, and `app`, its older name. The
 * launch migration changes only their accessibility attribute, in place. The gated service (`app:auth`) is never in this
 * list: changing one of those needs Face ID, so it moves after its own authenticated read instead.
 */
export const IOS_SECURE_STORE_SERVICES = ["app:no-auth", "app"] as const;

/** A plain path from a file URL or a path, with no trailing slash. */
function plainPath(uriOrPath: string): string {
  const path = uriOrPath.startsWith("file://") ? decodeURI(uriOrPath.slice("file://".length)) : uriOrPath;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * What is excluded from backup, at launch and when each is created: the documents folder (QVAC's home: its caches live
 * in `.qvac`, the model in `models`), those two folders by name in case the folder's flag is ever lost, and the
 * database (op-sqlite keeps it in Library) with its journal siblings. Missing paths are skipped natively.
 */
export function backupTargets(documentUri: string, dbPath?: string): string[] {
  const docs = plainPath(documentUri);
  const out = [docs, `${docs}/models`, `${docs}/.qvac`];
  if (dbPath) {
    const db = plainPath(dbPath);
    out.push(...["", "-wal", "-shm", "-journal"].map((suffix) => `${db}${suffix}`));
  }
  return out;
}

/** One item the launch migration looked at, as the HermitVault module reports it. */
export interface KeychainMove {
  service: string;
  key: string;
  before: string;
  after: string;
  ok: boolean;
}

/** Which keys moved, which were already kept on this phone, and which still aren't (to try again at the next launch). */
export function migrationSummary(moves: readonly KeychainMove[]): { moved: string[]; kept: string[]; failed: string[] } {
  const out = { moved: [] as string[], kept: [] as string[], failed: [] as string[] };
  for (const m of moves) {
    if (!m.ok || !isThisDeviceOnly(m.after)) out.failed.push(m.key);
    else if (isThisDeviceOnly(m.before)) out.kept.push(m.key);
    else out.moved.push(m.key);
  }
  return out;
}

/**
 * Lines (1-based) of `SecureStore.setItemAsync(...)` calls whose options aren't built by `keychain(...)`, so a new write
 * can't forget the ThisDeviceOnly class. The one other builder allowed is `keychainAsBefore(...)`, which puts a gated
 * item back as it was when its move failed. A call is read up to its closing parenthesis.
 */
export function keychainWritesWithoutOptions(src: string): number[] {
  const out: number[] = [];
  const re = /SecureStore\.setItemAsync\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    const args = src.slice(m.index + m[0].length, i - 1);
    if (!/\bkeychain(AsBefore)?\(/.test(args)) out.push(src.slice(0, m.index).split("\n").length);
  }
  return out;
}
