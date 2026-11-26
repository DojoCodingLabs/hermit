import ExpoModulesCore
import UIKit

/**
 On iOS, for now: the vault's native pieces FAIL CLOSED here.

 There is no hardware-wrapped vault key on iOS yet, so every key, document and secret call rejects (and
 `hasWrappedKey` never says a key exists). The one call that works is `copyPlain`, for public text such as a Device lab
 report: a plain clip on the general pasteboard, local to this phone (no Handoff), with no timer.

 The two delete calls succeed with nothing to do: no Keystore key or preferences file is ever made on iOS. They must not
 throw, because Delete everything stops at the first step that fails, and the steps after this one remove the Keychain
 entries (database key, approval and wallet keys, connector tokens) that iOS keeps even after the app is deleted.
 */
public class HermitVaultModule: Module {
  private static func unavailable() -> Exception {
    return Exception(name: "VaultUnavailable", description: "The vault is not available on iOS yet.", code: "ERR_UNAVAILABLE")
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
  }
}
