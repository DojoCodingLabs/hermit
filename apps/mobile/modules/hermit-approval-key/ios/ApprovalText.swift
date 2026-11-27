import Foundation

/**
 SL-37 on iOS: what the Face ID or Touch ID prompt says, the same rules as Android's ApprovalText.kt.

 - The title, the button and the labels are this module's own strings, picked by a locale code ("en" or "es-419");
   JavaScript passes no display text at all.
 - Every fact (amount, recipient, network, site, and for a login the app, its key and the browser) is read from the very
   message being signed, never from a separate display string.
 - Control characters, bidi overrides and isolates, zero-width and line separators are stripped from the values, and the
   recipient and site are shown in full, never truncated.
 */
enum ApprovalText {
  static let approvalDomain = "hermit.approval.v1"
  static let enrollDomain = "hermit.approval-key.enroll.v1"

  /** USD₮ has 6 decimals (CT-01). The only asset Hermit pays in (PDR-027). */
  private static let usdtDecimals = 6

  /** SL-40: the networks the prompt names in words, keyed by the CAIP-2 id in the signed payload only. */
  private static let networkNames = ["eip155:2201": "Stable testnet"]

  struct Approval: Equatable {
    let risk: String
    let amount: String?
    let network: String?
    let recipient: String?
    let origin: String?
    let requester: String?
    let expiresAt: Int64
  }

  struct Strings {
    let payTitle: String
    let passwordTitle: String
    let enrollTitle: String
    let enrollDescription: String
    let cancel: String
    let amount: String
    let to: String
    let network: String
    let site: String
    let app: String
    let appKey: String
    let browser: String
  }

  private static let en = Strings(
    payTitle: "Approve this payment",
    passwordTitle: "Approve using this password",
    enrollTitle: "Set up your approval key",
    enrollDescription: "Payments and passwords will need your fingerprint, every time.",
    cancel: "Cancel",
    amount: "Amount",
    to: "To",
    network: "Network",
    site: "Site",
    app: "App",
    appKey: "Signing key",
    browser: "Browser"
  )

  private static let es419 = Strings(
    payTitle: "Aprueba este pago",
    passwordTitle: "Aprueba usar esta contraseña",
    enrollTitle: "Configura tu clave de aprobación",
    enrollDescription: "Los pagos y las contraseñas pedirán tu huella, cada vez.",
    cancel: "Cancelar",
    amount: "Monto",
    to: "Para",
    network: "Red",
    site: "Sitio",
    app: "App",
    appKey: "Clave de firma",
    browser: "Navegador"
  )

  /** Only the two locales Hermit ships; anything else is English. */
  static func strings(_ locale: String) -> Strings { locale == "es-419" ? es419 : en }

  /** The payload of an approval message, or nil when it isn't one (wrong domain, not JSON, not USD₮). */
  static func parse(_ message: String) -> Approval? {
    let prefix = "\(approvalDomain)\n"
    guard message.hasPrefix(prefix),
          let data = String(message.dropFirst(prefix.count)).data(using: .utf8),
          let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
    guard o["domain"] as? String == approvalDomain, (o["v"] as? NSNumber)?.intValue == 1 else { return nil }
    guard let risk = o["risk"] as? String, risk == "spend" || risk == "credential" else { return nil }
    var value: String?
    var network: String?
    if let raw = o["amount"] {
      guard let amount = raw as? [String: Any], amount["asset"] as? String == "USDT",
            let v = amount["value"] as? String, v.range(of: "^[1-9][0-9]*$", options: .regularExpression) != nil else { return nil }
      value = v
      network = amount["network"] as? String
    }
    let recipient = o["recipient"] as? String
    let origin = o["origin"] as? String
    if o["recipient"] != nil && recipient == nil { return nil }
    if o["origin"] != nil && origin == nil { return nil }
    if risk == "spend" && (value == nil || recipient == nil) { return nil }
    if risk == "credential" && origin == nil { return nil }
    return Approval(
      risk: risk, amount: value, network: network, recipient: recipient, origin: origin,
      requester: o["requester"] as? String, expiresAt: (o["expiresAt"] as? NSNumber)?.int64Value ?? 0
    )
  }

  /**
   A value as one visible line: drops control characters (newlines included), format characters (bidi overrides,
   isolates, zero-width marks), line or paragraph separators, unassigned, private use and surrogate code points.
   Nothing is truncated.
   */
  static func clean(_ value: String) -> String {
    var out = String.UnicodeScalarView()
    for scalar in value.unicodeScalars {
      switch scalar.properties.generalCategory {
      case .control, .format, .lineSeparator, .paragraphSeparator, .unassigned, .privateUse, .surrogate: continue
      default: out.append(scalar)
      }
    }
    return String(out).trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /** Base units to a decimal string ("5000000" is "5", "1500000" is "1.5"). Plain digits, never grouped or rounded. */
  static func usdt(_ baseUnits: String) -> String {
    let digits = String(repeating: "0", count: max(0, usdtDecimals + 1 - baseUnits.count)) + baseUnits
    let whole = String(digits.dropLast(usdtDecimals))
    var fraction = String(digits.suffix(usdtDecimals))
    while fraction.hasSuffix("0") { fraction.removeLast() }
    return fraction.isEmpty ? whole : "\(whole).\(fraction)"
  }

  /** The name for a CAIP-2 id from the signed payload ("eip155:2201" is "Stable testnet"), else the id itself, cleaned. */
  static func networkName(_ id: String) -> String { networkNames[id] ?? clean(id) }

  static func title(_ a: Approval, _ locale: String) -> String {
    let s = strings(locale)
    return a.risk == "spend" ? s.payTitle : s.passwordTitle
  }

  /** The prompt's description, one fact per line, every value from the signed payload. */
  static func describe(_ a: Approval, _ locale: String) -> String {
    let s = strings(locale)
    guard a.risk == "spend", let amount = a.amount, let recipient = a.recipient else { return credential(a, s) }
    var lines = ["\(s.amount): \(usdt(amount)) USD₮", "\(s.to): \(clean(recipient))"]
    if let network = a.network { lines.append("\(s.network): \(networkName(network))") }
    return lines.joined(separator: "\n")
  }

  /** `android://<cert>@<package>`: the cert and the package, or nil. */
  private static func app(_ value: String) -> (cert: String, package: String)? {
    guard value.hasPrefix("android://") else { return nil }
    let rest = value.dropFirst("android://".count)
    guard let at = rest.firstIndex(of: "@") else { return nil }
    let cert = rest[rest.startIndex..<at]
    let package = rest[rest.index(after: at)...]
    guard !cert.isEmpty, !package.isEmpty else { return nil }
    return (String(cert), String(package))
  }

  /** A password's site, or SL-36's app by package and signing key, and for a login in a browser the browser it goes to. */
  private static func credential(_ a: Approval, _ s: Strings) -> String {
    let origin = clean(a.origin ?? "")
    var lines: [String] = []
    if let app = app(origin) {
      lines.append("\(s.app): \(app.package)")
      lines.append("\(s.appKey): \(app.cert)")
    } else {
      lines.append("\(s.site): \(origin)")
    }
    if let requester = a.requester.map(clean), requester != origin, let via = app(requester) {
      lines.append("\(s.browser): \(via.package)")
    }
    return lines.joined(separator: "\n")
  }
}

/** The key's formats, as the cage reads them (packages/cage/src/signed-approval.ts). */
enum ApprovalKeyFormat {
  /** The DER header of an X.509 SubjectPublicKeyInfo for a P-256 key, before the 65-byte uncompressed point. */
  static let p256SpkiPrefix: [UInt8] = [
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
  ]

  static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

  /**
   The SubjectPublicKeyInfo of a P-256 public key, from what `SecKeyCopyExternalRepresentation` gives (X9.63: 0x04, X, Y),
   so the pinned key reads the same as Android's `getEncoded()`. Nil for anything that isn't a 65-byte uncompressed point.
   */
  static func spki(x963: Data) -> Data? {
    guard x963.count == 65, x963.first == 0x04 else { return nil }
    return Data(p256SpkiPrefix) + x963
  }
}
