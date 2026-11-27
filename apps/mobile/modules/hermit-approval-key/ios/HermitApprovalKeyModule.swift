import ExpoModulesCore
import Foundation
import LocalAuthentication
import Security

/**
 SL-37 on iOS (US-CAGE-03, FR-CAGE-06, ADR-007): the key that signs money and password approvals, with the same contract
 as the Android Keystore key (android/.../HermitApprovalKeyModule.kt).

 - EC P-256, made inside the Secure Enclave and never exportable: only the public part is read. There is no software
   key, ever: if the Secure Enclave can't make the key, enrollment fails and nothing is stored.
 - Its access control is `.privateKeyUsage` and `.biometryCurrentSet` only: Face ID or Touch ID for every signature, no
   passcode fallback, and no reuse of an earlier match (each call uses a fresh LAContext, reuse duration 0).
 - Adding or removing a face or a finger retires it: the Secure Enclave never signs with it again, and `state` reports
   "lost" without a prompt, by comparing the biometric set recorded at enrollment with today's. Money and passwords are
   then blocked until the user sets the key up again.
 - The signature is ECDSA with SHA-256 over the message's exact UTF-8 bytes, in DER (X9.62), the same bytes Android's
   SHA256withECDSA gives; the public key is the X.509 SubjectPublicKeyInfo, as Android's `getEncoded()`.
 - Every word of the prompt is chosen here (ApprovalText.swift): its own strings by locale code, and the facts read from
   the message being signed. JavaScript passes no display text.
 */
public class HermitApprovalKeyModule: Module {
  private static let tag = Data("hermit.approval-key.v1".utf8)
  /** Where the enrolled biometric set is recorded (a Keychain item on this device only, deleted with the key). */
  private static let biometryService = "hermit.approval-key.v1"
  private static let biometryAccount = "biometry-set"
  private static let level = "secure_enclave"

  private let lock = NSLock()
  private var prompting = false

  private struct Failure: Error {
    let code: String
    let message: String
  }

  // MARK: The biometric set

  private enum Biometry {
    /** Face ID or Touch ID is enrolled; `set` identifies the enrolled faces or fingers (nil while locked out). */
    case available(set: Data?)
    case lockedOut
    case none
  }

  private func biometry() -> Biometry {
    let context = LAContext()
    defer { context.invalidate() }
    var error: NSError?
    if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
      return .available(set: context.evaluatedPolicyDomainState)
    }
    if let error, error.domain == LAError.errorDomain, error.code == LAError.Code.biometryLockout.rawValue { return .lockedOut }
    return .none
  }

  private func biometryQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.biometryService,
      kSecAttrAccount as String: Self.biometryAccount,
    ]
  }

  private func enrolledBiometry() -> Data? {
    var query = biometryQuery()
    query[kSecReturnData as String] = true
    var out: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess else { return nil }
    return out as? Data
  }

  private func recordBiometry(_ set: Data) -> Bool {
    SecItemDelete(biometryQuery() as CFDictionary)
    var item = biometryQuery()
    item[kSecValueData as String] = set
    item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
    return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
  }

  /** True when the faces or fingers enrolled today aren't the ones the key was made under. Unknown counts as changed. */
  private func biometryChanged(_ now: Biometry) -> Bool {
    guard let enrolled = enrolledBiometry() else { return true }
    switch now {
    case .available(let set?): return set != enrolled
    // Locked out: the set can't be read now, and the Secure Enclave still refuses a changed set when signing.
    case .available(nil), .lockedOut: return false
    case .none: return true
    }
  }

  // MARK: The key

  private enum Lookup {
    case found(SecKey)
    case missing
    case unusable
  }

  private func findKey(context: LAContext? = nil) -> Lookup {
    var query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrApplicationTag as String: Self.tag,
      kSecReturnRef as String: true,
    ]
    if let context { query[kSecUseAuthenticationContext as String] = context }
    var out: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &out)
    if status == errSecItemNotFound { return .missing }
    guard status == errSecSuccess, let ref = out, CFGetTypeID(ref) == SecKeyGetTypeID() else { return .unusable }
    let key = ref as! SecKey
    return inSecureEnclave(key) ? .found(key) : .unusable
  }

  /** A key Hermit would trust: P-256, kept by the Secure Enclave. Anything else is never used. */
  private func inSecureEnclave(_ key: SecKey) -> Bool {
    guard let attrs = SecKeyCopyAttributes(key) as? [String: Any] else { return false }
    return attrs[kSecAttrTokenID as String] as? String == (kSecAttrTokenIDSecureEnclave as String)
      && attrs[kSecAttrKeySizeInBits as String] as? Int == 256
  }

  /** The public part as the cage reads it: the X.509 SubjectPublicKeyInfo, in lowercase hex. */
  private func publicKey(_ key: SecKey) -> String? {
    guard let pub = SecKeyCopyPublicKey(key), let x963 = SecKeyCopyExternalRepresentation(pub, nil) as Data?,
          let spki = ApprovalKeyFormat.spki(x963: x963) else { return nil }
    return ApprovalKeyFormat.hex(spki)
  }

  private func destroy() {
    let key: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      kSecAttrApplicationTag as String: Self.tag,
    ]
    SecItemDelete(key as CFDictionary)
    SecItemDelete(biometryQuery() as CFDictionary)
  }

  /** A new key in the Secure Enclave, replacing any old one. Never a software key: no Secure Enclave, no key. */
  private func generate() throws -> SecKey {
    destroy()
    var error: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(
      nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, [.privateKeyUsage, .biometryCurrentSet], &error
    ) else {
      throw Failure(code: "failed", message: "No access control for the key.")
    }
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: Self.tag,
        kSecAttrAccessControl as String: access,
      ] as [String: Any],
    ]
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      throw Failure(code: "no_secure_hardware", message: "This phone can't keep the key in the Secure Enclave.")
    }
    guard inSecureEnclave(key) else {
      throw Failure(code: "no_secure_hardware", message: "This phone can't keep the key in the Secure Enclave.")
    }
    return key
  }

  // MARK: Signing

  /**
   One Face ID or Touch ID check, one signature over exactly `message`. The fresh context allows no earlier match and
   no passcode; the Secure Enclave checks the key's own access control. Blocks until the prompt is answered.
   */
  private func signOnce(_ message: String, reason: String, cancel: String) throws -> String {
    let context = LAContext()
    defer { context.invalidate() }
    context.touchIDAuthenticationAllowableReuseDuration = 0
    context.localizedFallbackTitle = ""
    context.localizedCancelTitle = cancel
    context.localizedReason = reason
    guard case .found(let key) = findKey(context: context) else { throw Failure(code: "lost", message: "No approval key.") }
    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, Data(message.utf8) as CFData, &error) as Data? else {
      throw Self.failure(error?.takeRetainedValue())
    }
    return ApprovalKeyFormat.hex(signature)
  }

  /** What went wrong at the prompt, as the codes the app maps to copy. Anything unexpected is "failed". */
  private static func failure(_ error: CFError?) -> Failure {
    guard let cf = error else { return Failure(code: "failed", message: "No signature.") }
    let error = cf as Error as NSError
    let code: String
    if error.domain == LAError.errorDomain {
      switch LAError.Code(rawValue: error.code) {
      case .userCancel, .appCancel, .systemCancel, .userFallback: code = "cancelled"
      case .biometryLockout: code = "lockout"
      case .biometryNotAvailable, .biometryNotEnrolled, .passcodeNotSet: code = "no_biometric"
      default: code = "failed"
      }
    } else if error.domain == NSOSStatusErrorDomain {
      switch OSStatus(error.code) {
      case errSecUserCanceled: code = "cancelled"
      case errSecItemNotFound: code = "lost"
      default: code = "failed"
      }
    } else {
      code = "failed"
    }
    return Failure(code: code, message: error.localizedDescription)
  }

  private func state() -> [String: Any] {
    let now = biometry()
    if case .none = now { return ["state": "no_biometric"] }
    switch findKey() {
    case .missing: return ["state": "none"]
    case .unusable: return ["state": "lost"]
    case .found(let key):
      // Fail closed: a key made under other faces or fingers, or one whose public part can't be read, is lost.
      if biometryChanged(now) { return ["state": "lost"] }
      guard let pub = publicKey(key) else { return ["state": "lost"] }
      return ["state": "ready", "publicKey": pub, "level": Self.level]
    }
  }

  /** At most one prompt at a time, as on Android ("busy"). The prompt itself runs off the module's queue. */
  private func withPrompt(_ promise: Promise, _ work: @escaping () throws -> Any) {
    lock.lock()
    if prompting {
      lock.unlock()
      promise.reject("busy", "A Face ID or Touch ID prompt is already open.")
      return
    }
    prompting = true
    lock.unlock()
    DispatchQueue.global(qos: .userInitiated).async {
      defer {
        self.lock.lock()
        self.prompting = false
        self.lock.unlock()
      }
      do {
        promise.resolve(try work())
      } catch let failure as Failure {
        promise.reject(failure.code, failure.message)
      } catch {
        promise.reject("failed", error.localizedDescription)
      }
    }
  }

  private static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

  public func definition() -> ModuleDefinition {
    Name("HermitApprovalKey")

    AsyncFunction("state") { () -> [String: Any] in
      self.state()
    }

    /**
     Makes a new key (replacing any old one) and proves it with a fresh Face ID or Touch ID: the new key signs the
     enrollment challenge behind the prompt. Any failure leaves no key behind.
     */
    AsyncFunction("enroll") { (message: String, locale: String, promise: Promise) in
      self.withPrompt(promise) {
        guard message.hasPrefix("\(ApprovalText.enrollDomain)\n") else { throw Failure(code: "bad_message", message: "Not an enrollment challenge.") }
        let set: Data
        switch self.biometry() {
        case .available(let s?): set = s
        case .available(nil), .lockedOut: throw Failure(code: "lockout", message: "Face ID or Touch ID is locked.")
        case .none: throw Failure(code: "no_biometric", message: "No Face ID or Touch ID is enrolled.")
        }
        do {
          let key = try self.generate()
          guard let pub = self.publicKey(key) else { throw Failure(code: "failed", message: "No public key.") }
          let s = ApprovalText.strings(locale)
          let signature = try self.signOnce(message, reason: "\(s.enrollTitle)\n\(s.enrollDescription)", cancel: s.cancel)
          guard self.recordBiometry(set) else { throw Failure(code: "failed", message: "The biometric set wasn't recorded.") }
          return ["publicKey": pub, "level": Self.level, "signature": signature]
        } catch {
          self.destroy()
          throw error
        }
      }
    }

    /** Signs one approval message. The prompt shows the amount and recipient (or the site) read from the message. */
    AsyncFunction("sign") { (message: String, locale: String, promise: Promise) in
      self.withPrompt(promise) {
        guard let approval = ApprovalText.parse(message) else { throw Failure(code: "bad_message", message: "Not an approval Hermit signs.") }
        guard approval.expiresAt > Self.nowMs() else { throw Failure(code: "expired", message: "The approval expired.") }
        let now = self.biometry()
        if case .none = now { throw Failure(code: "no_biometric", message: "No Face ID or Touch ID is enrolled.") }
        guard case .found = self.findKey() else { throw Failure(code: "lost", message: "No approval key.") }
        if self.biometryChanged(now) { throw Failure(code: "lost", message: "The approval key was retired.") }
        let reason = "\(ApprovalText.title(approval, locale))\n\(ApprovalText.describe(approval, locale))"
        return try self.signOnce(message, reason: reason, cancel: ApprovalText.strings(locale).cancel)
      }
    }

    /** Delete everything (SL-26). Idempotent. */
    AsyncFunction("destroy") { () in
      self.destroy()
    }
  }
}
