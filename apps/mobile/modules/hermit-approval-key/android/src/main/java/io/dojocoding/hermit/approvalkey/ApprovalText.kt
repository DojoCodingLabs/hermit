package io.dojocoding.hermit.approvalkey

import java.math.BigDecimal
import org.json.JSONObject

/**
 * SL-37: what the system fingerprint prompt says. It is the last line of defense, so every word of it is chosen here:
 * - the title, the button and the labels are this module's own strings, picked by a locale code ("en" or "es-419");
 *   JavaScript passes no display text at all;
 * - every fact (amount, recipient, network, site, and for a login the app, its key and the browser) is read from the
 *   very message being signed, never from a separate display string, so a compromised app can't show one payment
 *   and get another signed;
 * - control characters, bidi overrides and isolates, zero-width and line separators are stripped from the values,
 *   and the recipient and site are shown in full, never truncated.
 */
object ApprovalText {
  const val APPROVAL_DOMAIN = "hermit.approval.v1"
  const val ENROLL_DOMAIN = "hermit.approval-key.enroll.v1"

  /** USD₮ has 6 decimals (CT-01). The only asset Hermit pays in (PDR-027). */
  private const val USDT_DECIMALS = 6

  /**
   * SL-40: the networks the prompt names in words, keyed by the CAIP-2 id in the signed payload's `amount.network`.
   * The name is this module's own, looked up from that id only, never taken from text JavaScript passes. An id that
   * isn't listed is shown as it is (cleaned), so the prompt never names a network the payload doesn't carry.
   */
  private val NETWORK_NAMES = mapOf("eip155:2201" to "Stable testnet")

  data class Approval(
    val risk: String,
    val amount: String?,
    val network: String?,
    val recipient: String?,
    val origin: String?,
    /** SL-36: who receives a login's values, `android://<cert>@<package>` (the trusted browser, or the app itself). */
    val requester: String?,
    val expiresAt: Long,
  )

  data class Strings(
    val payTitle: String,
    val passwordTitle: String,
    val enrollTitle: String,
    val enrollDescription: String,
    val cancel: String,
    val amount: String,
    val to: String,
    val network: String,
    val site: String,
    val app: String,
    val appKey: String,
    val browser: String,
  )

  private val EN = Strings(
    payTitle = "Approve this payment",
    passwordTitle = "Approve using this password",
    enrollTitle = "Set up your approval key",
    enrollDescription = "Payments and passwords will need your fingerprint, every time.",
    cancel = "Cancel",
    amount = "Amount",
    to = "To",
    network = "Network",
    site = "Site",
    app = "App",
    appKey = "Signing key",
    browser = "Browser",
  )

  private val ES_419 = Strings(
    payTitle = "Aprueba este pago",
    passwordTitle = "Aprueba usar esta contraseña",
    enrollTitle = "Configura tu clave de aprobación",
    enrollDescription = "Los pagos y las contraseñas pedirán tu huella, cada vez.",
    cancel = "Cancelar",
    amount = "Monto",
    to = "Para",
    network = "Red",
    site = "Sitio",
    app = "App",
    appKey = "Clave de firma",
    browser = "Navegador",
  )

  /** Only the two locales Hermit ships; anything else is English. */
  fun strings(locale: String): Strings = if (locale == "es-419") ES_419 else EN

  /** The payload of an approval message, or null when it isn't one (wrong domain, not JSON, not USD₮). */
  fun parse(message: String): Approval? {
    val prefix = "$APPROVAL_DOMAIN\n"
    if (!message.startsWith(prefix)) return null
    val o = try {
      JSONObject(message.substring(prefix.length))
    } catch (e: Exception) {
      return null
    }
    if (o.optString("domain") != APPROVAL_DOMAIN || o.optInt("v") != 1) return null
    val risk = o.optString("risk")
    if (risk != "spend" && risk != "credential") return null
    val amount = o.optJSONObject("amount")
    if (amount != null && amount.optString("asset") != "USDT") return null
    val value = amount?.optString("value")
    if (value != null && !Regex("^[1-9][0-9]*$").matches(value)) return null
    if (risk == "spend" && (amount == null || !o.has("recipient"))) return null
    if (risk == "credential" && !o.has("origin")) return null
    return Approval(
      risk = risk,
      amount = value,
      network = amount?.optString("network"),
      recipient = if (o.has("recipient")) o.getString("recipient") else null,
      origin = if (o.has("origin")) o.getString("origin") else null,
      requester = if (o.has("requester")) o.getString("requester") else null,
      expiresAt = o.optLong("expiresAt", 0L),
    )
  }

  /**
   * A value as one visible line: drops control characters (Cc, newlines included), format characters (Cf: bidi
   * overrides U+202A to U+202E, isolates U+2066 to U+2069, zero-width joiners and marks) and line or paragraph
   * separators. Nothing is truncated.
   */
  fun clean(value: String): String {
    val out = StringBuilder()
    var i = 0
    while (i < value.length) {
      val cp = value.codePointAt(i)
      when (Character.getType(cp).toByte()) {
        Character.CONTROL, Character.FORMAT, Character.LINE_SEPARATOR, Character.PARAGRAPH_SEPARATOR, Character.UNASSIGNED,
        Character.PRIVATE_USE, Character.SURROGATE -> {}
        else -> out.appendCodePoint(cp)
      }
      i += Character.charCount(cp)
    }
    return out.toString().trim()
  }

  /** Base units to a decimal string ("5000000" is "5", "1500000" is "1.5"). Plain digits, never grouped or rounded. */
  fun usdt(baseUnits: String): String = BigDecimal(baseUnits).movePointLeft(USDT_DECIMALS).stripTrailingZeros().toPlainString()

  /** The name for a CAIP-2 id from the signed payload ("eip155:2201" is "Stable testnet"), else the id itself, cleaned. */
  fun networkName(id: String): String = NETWORK_NAMES[id] ?: clean(id)

  fun title(a: Approval, locale: String): String = strings(locale).let { if (a.risk == "spend") it.payTitle else it.passwordTitle }

  /** The prompt's description, one fact per line, every value from the signed payload. */
  fun describe(a: Approval, locale: String): String {
    val s = strings(locale)
    return when (a.risk) {
      "spend" -> listOfNotNull(
        "${s.amount}: ${usdt(a.amount!!)} USD₮",
        "${s.to}: ${clean(a.recipient!!)}",
        a.network?.let { "${s.network}: ${networkName(it)}" },
      ).joinToString("\n")
      else -> credential(a, s)
    }
  }

  private val APP = Regex("^android://([^@]+)@(.+)$")

  /**
   * A password's site, or SL-36's app by package and signing key, and for a login in a browser the browser it goes
   * to. All read from the signed payload (`origin`, `requester`); the browser line is shown only when it differs.
   */
  private fun credential(a: Approval, s: Strings): String {
    val origin = clean(a.origin!!)
    val app = APP.matchEntire(origin)
    val lines = ArrayList<String>()
    if (app != null) {
      lines.add("${s.app}: ${app.groupValues[2]}")
      lines.add("${s.appKey}: ${app.groupValues[1]}")
    } else {
      lines.add("${s.site}: $origin")
    }
    val requester = a.requester?.let { clean(it) }
    val via = requester?.let { APP.matchEntire(it) }
    if (via != null && requester != origin) lines.add("${s.browser}: ${via.groupValues[2]}")
    return lines.joinToString("\n")
  }
}
