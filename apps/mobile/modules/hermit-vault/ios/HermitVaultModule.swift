import ExpoModulesCore
import LocalAuthentication
import Security
import UIKit

/**
 On iOS, for now: the vault's native pieces FAIL CLOSED here.

 There is no hardware-wrapped vault key on iOS yet, so every key, document and secret call rejects (and
 `hasWrappedKey` never says a key exists). The one call that works is `copyPlain`, for public text such as a Device lab
 report: a plain clip on the general pasteboard, local to this phone (no Handoff), with no timer.

 The two delete calls succeed with nothing to do: no Keystore key or preferences file is ever made on iOS. They must not
 throw, because Delete everything stops at the first step that fails, and the steps after this one remove the Keychain
 entries (database key, approval and wallet keys, connector tokens) that iOS keeps even after the app is deleted.

 #126: three calls keep Hermit out of iCloud and computer backups. `excludeFromBackup` flags files and folders;
 `keychainAccessibility` reads an item's protection class without ever showing Face ID; `keychainToThisDevice` moves
 the plain SecureStore items to WhenUnlockedThisDeviceOnly in place (the value is never read or rewritten).
 */
public class HermitVaultModule: Module {
  private static func unavailable() -> Exception {
    return Exception(name: "VaultUnavailable", description: "The vault is not available on iOS yet.", code: "ERR_UNAVAILABLE")
  }

  /** expo-secure-store's item for `key` under `service` (its kSecAttrService, with the `:no-auth` or `:auth` suffix). */
  private static func itemQuery(service: String, key: String) -> [String: Any] {
    let account = Data(key.utf8)
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrGeneric as String: account,
      kSecAttrAccount as String: account,
    ]
  }

  /** A context that refuses any prompt: a call that would need Face ID fails instead of asking. */
  private static func silentContext() -> LAContext {
    let context = LAContext()
    context.interactionNotAllowed = true
    return context
  }

  /** The item's protection class (`ak`, `aku`, ...), nil when there is none, "unknown" when iOS won't say silently. */
  private static func accessibility(service: String, key: String) -> String? {
    var query = itemQuery(service: service, key: key)
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    query[kSecReturnAttributes as String] = kCFBooleanTrue
    query[kSecUseAuthenticationContext as String] = silentContext()
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let attrs = item as? [String: Any] else { return "unknown" }
    return attrs[kSecAttrAccessible as String] as? String ?? "unknown"
  }

  /** The classes that never leave this phone (the same list as backup-guard.ts). */
  private static let thisDeviceOnly: Set<String> = [
    kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String,
    kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String,
    kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly as String,
    "dku",
  ]

  /** Every item's key (its kSecAttrAccount) under `service`, read from attributes only, never the values. */
  private static func keys(service: String) -> [String] {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecMatchLimit as String: kSecMatchLimitAll,
      kSecReturnAttributes as String: true,
      kSecUseAuthenticationContext as String: silentContext(),
    ]
    var items: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &items) == errSecSuccess, let list = items as? [[String: Any]] else { return [] }
    return list.compactMap { attrs in
      guard let account = attrs[kSecAttrAccount as String] as? Data else { return nil }
      return String(data: account, encoding: .utf8)
    }
  }

  public func definition() -> ModuleDefinition {
    Name("HermitVault")

    AsyncFunction("hasWrappedKey") { (_: String, _: String) -> Bool in
      throw HermitVaultModule.unavailable()
    }

    AsyncFunction("deletePreferences") { (_: [String]) in
      // Nothing was ever written, so there is nothing to delete.
    }

    AsyncFunction("destroyKeystoreKey") { (_: String) in
      // Nothing was ever made, so there is nothing to destroy.
    }

    AsyncFunction("setSecureScreen") { (_: Bool) -> Bool in
      return false
    }

    AsyncFunction("copySensitive") { (_: String, _: Double) in
      throw HermitVaultModule.unavailable()
    }

    AsyncFunction("copyPlain") { (text: String) in
      UIPasteboard.general.setItems([["public.utf8-plain-text": text]], options: [.localOnly: true])
    }.runOnQueue(.main)

    AsyncFunction("clearPendingCopy") { () in
      // copySensitive never copies on iOS, so nothing is ever pending.
    }

    AsyncFunction("pickCsv") { () -> [String: Any]? in
      throw HermitVaultModule.unavailable()
    }

    AsyncFunction("readDocument") { (_: String, _: Double) -> Data in
      throw HermitVaultModule.unavailable()
    }

    AsyncFunction("deleteDocument") { (_: String) -> Bool in
      throw HermitVaultModule.unavailable()
    }

    // #126: flags each path that exists as excluded from backup, then reads the flag back. Missing paths are left out.
    AsyncFunction("excludeFromBackup") { (paths: [String]) -> [String: Bool] in
      var out: [String: Bool] = [:]
      for path in paths where FileManager.default.fileExists(atPath: path) {
        var url = URL(fileURLWithPath: path)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        do {
          try url.setResourceValues(values)
          url.removeAllCachedResourceValues()
          out[path] = try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup ?? false
        } catch {
          out[path] = false
        }
      }
      return out
    }

    AsyncFunction("keychainAccessibility") { (service: String, key: String) -> String? in
      return HermitVaultModule.accessibility(service: service, key: key)
    }

    // #126: each item under these (plain) services that could move with a backup gets WhenUnlockedThisDeviceOnly in
    // place: SecItemUpdate changes the attribute only, so the value is never at risk. Its class is then read back. An
    // item that would need Face ID fails silently (no prompt) and is reported as not ok.
    AsyncFunction("keychainToThisDevice") { (services: [String]) -> [[String: Any]] in
      var report: [[String: Any]] = []
      for service in services {
        for key in HermitVaultModule.keys(service: service) {
          let before = HermitVaultModule.accessibility(service: service, key: key) ?? "none"
          var ok = true
          if !HermitVaultModule.thisDeviceOnly.contains(before) {
            var query = HermitVaultModule.itemQuery(service: service, key: key)
            query[kSecUseAuthenticationContext as String] = HermitVaultModule.silentContext()
            let change: [String: Any] = [kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
            ok = SecItemUpdate(query as CFDictionary, change as CFDictionary) == errSecSuccess
          }
          let after = HermitVaultModule.accessibility(service: service, key: key) ?? "none"
          report.append(["service": service, "key": key, "before": before, "after": after, "ok": ok])
        }
      }
      return report
    }
  }
}
