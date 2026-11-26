package io.dojocoding.hermit.autofill

import java.util.Locale

/** One web page node Android reported (ViewNode.getWebDomain and getWebScheme). Android reports no port. */
data class WebNode(val domain: String, val scheme: String?)

/** Who asks to be filled: the package, its current signing certificate digests, and the web origin of each field. */
data class FillOrigin(val packageName: String, val certDigests: List<String>, val web: List<WebNode>)

/** `match` with the origin, or a refusal reason; `origin` is set whenever the request had one. */
data class MatchResult(val match: Boolean, val origin: String?, val reason: String?)

/**
 * SL-36: one vault login as the service sees it before anything is approved: the item's id hash (`ref`), its name and
 * its exact origins. Never a username, a password or a note (LoginIndexEntry in packages/core).
 */
data class LoginEntry(val ref: String, val name: String, val origins: List<String>)

/** The logins offered to a request, in index order; empty with the reason when none is. */
data class LoginOffer(val origin: String?, val reason: String?, val refs: List<String>)

/**
 * SL-20, FR-VAULT-04: the Kotlin mirror of packages/core/src/autofill-origin.ts. Pure Kotlin (no Android types), so
 * OriginMatchTest runs the shared vectors on the JVM. Change both files and the vectors together.
 *
 * Origins are `https://host[:port]`, `http://host[:port]` or `android://<cert>@<package>`, where `<cert>` is the
 * SHA-256 of the signing certificate in base64url without padding. Exact means equal after canonical form only.
 * A web domain is believed only from a browser whose package and certificate are both on the allowlist.
 */
object OriginMatch {
  /**
   * Release builds from Google's Credential Manager privileged apps list
   * (https://www.gstatic.com/gpm-passkeys-privileged-apps/apps.json, read 2026-11-14), converted from colon hex.
   */
  val TRUSTED_BROWSERS: Map<String, List<String>> = mapOf(
    "com.android.chrome" to listOf("8P1sW0EPJcslw7UzRsiXL64w-O50Ed-RBICtay1g24M"),
    "com.sec.android.app.sbrowser" to listOf("NN8Oep8c8YkuRcBWtJc82BzPFIpAUNEa6krFpl-QCkI"),
    "org.mozilla.firefox" to listOf("p4tipRZbRJSy_q2edqKA0i2Tf-5iUa7OWZRGsuoxmwQ"),
  )

  private val PACKAGE = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$")
  private val DIGEST = Regex("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")
  private val APP = Regex("^android://([^@]+)@(.+)$")
  private const val LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
  private val HOST = Regex("^$LABEL(?:\\.$LABEL)*$")
  private val WEB = Regex("^(https?)://([^/:?#@\\s]+)(?::(\\d{1,5}))?/?$", RegexOption.IGNORE_CASE)
  private val DEFAULT_PORT = mapOf("http" to "80", "https" to "443")

  private fun host(raw: String): String? {
    val h = raw.lowercase(Locale.ROOT).removeSuffix(".")
    return if (HOST.matches(h)) h else null
  }

  /** The canonical form of a stored or reported origin, or null when it is not exactly an origin. */
  fun normalize(origin: String): String? {
    if (origin.startsWith("android://")) {
      val m = APP.matchEntire(origin) ?: return null
      return if (DIGEST.matches(m.groupValues[1]) && PACKAGE.matches(m.groupValues[2])) origin else null
    }
    val m = WEB.matchEntire(origin) ?: return null
    val scheme = m.groupValues[1].lowercase(Locale.ROOT)
    val h = host(m.groupValues[2]) ?: return null
    val port = m.groups[3]?.value
    if (port != null) {
      val n = port.toInt()
      if (port.startsWith("0") || n < 1 || n > 65535) return null
      if (port != DEFAULT_PORT[scheme]) return "$scheme://$h:$port"
    }
    return "$scheme://$h"
  }

  /** The one origin a request comes from: Pair(origin, null), or Pair(null, reason). */
  fun requestOrigin(request: FillOrigin, browsers: Map<String, List<String>>): Pair<String?, String?> {
    if (!PACKAGE.matches(request.packageName)) return null to "bad_package"
    val certs = request.certDigests
    if (certs.isEmpty() || !certs.all { DIGEST.matches(it) }) return null to "no_signing_cert"
    if (certs.size > 1) return null to "multiple_signers"
    val cert = certs[0]
    val isBrowser = browsers[request.packageName]?.contains(cert) == true
    if (!isBrowser || request.web.isEmpty()) return "android://$cert@${request.packageName}" to null
    val seen = LinkedHashSet<String>()
    for (node in request.web) {
      val rawScheme = node.scheme
      if (rawScheme.isNullOrEmpty()) return null to "no_web_scheme"
      val scheme = rawScheme.lowercase(Locale.ROOT)
      val h = host(node.domain)
      if ((scheme != "https" && scheme != "http") || h == null) return null to "bad_web_origin"
      seen.add("$scheme://$h")
    }
    if (seen.size > 1) return null to "mixed_web_origins"
    return seen.first() to null
  }

  /** The most logins offered for one form (LOGIN_MAX_OFFERED in packages/core/src/autofill-origin.ts). */
  const val LOGIN_MAX_OFFERED = 5

  private val REF = Regex("^[0-9a-f]{64}$")

  /**
   * SL-36: which vault logins may be offered to this request (`loginsFor` in packages/core): only an item that stores
   * the requester's exact origin. A malformed ref or stored origin never matches.
   */
  fun loginsFor(request: FillOrigin, index: List<LoginEntry>, browsers: Map<String, List<String>> = TRUSTED_BROWSERS): LoginOffer {
    val (origin, refusal) = requestOrigin(request, browsers)
    if (origin == null) return LoginOffer(null, refusal, emptyList())
    val refs = index
      .filter { e -> REF.matches(e.ref) && e.origins.any { normalize(it) == origin } }
      .map { it.ref }
      .take(LOGIN_MAX_OFFERED)
    return if (refs.isEmpty()) LoginOffer(origin, "no_match", refs) else LoginOffer(origin, null, refs)
  }

  /** Whether a credential stored for `stored` origins may be offered. Malformed stored origins never match. */
  fun match(request: FillOrigin, stored: Collection<String>, browsers: Map<String, List<String>> = TRUSTED_BROWSERS): MatchResult {
    val (origin, refusal) = requestOrigin(request, browsers)
    if (origin == null) return MatchResult(false, null, refusal)
    val hit = stored.any { normalize(it) == origin }
    return if (hit) MatchResult(true, origin, null) else MatchResult(false, origin, "no_match")
  }
}
