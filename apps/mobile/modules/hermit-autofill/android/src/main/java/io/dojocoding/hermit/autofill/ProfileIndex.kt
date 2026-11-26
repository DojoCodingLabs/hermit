package io.dojocoding.hermit.autofill

import android.content.Context

/**
 * SL-35: which kinds Hermit's profile can fill and which of them are sensitive, written by Hermit's JS (`profileIndex`
 * in packages/core) whenever the profile changes. Kinds only, never a value: the service needs it to offer a
 * suggestion only where the profile has something, before anything is approved. Delete everything removes the file
 * (`hermit_autofill`, NATIVE_PREFERENCES in packages/core/src/erase.ts).
 */
data class Index(val kinds: Set<String>, val sensitive: Set<String>)

object ProfileIndex {
  const val FILE = "hermit_autofill"
  private const val KEY_KINDS = "profile_kinds"
  private const val KEY_SENSITIVE = "profile_sensitive"

  /** The kinds a form field can ask for (packages/core FormKind); anything else is dropped. */
  val FORM_KINDS = setOf(
    "given_name", "family_name", "full_name", "email", "phone", "street_address", "address_line2", "city", "region",
    "postal_code", "country", "birth_date", "id_number", "tax_id", "passport_number",
  )

  private fun prefs(context: Context) = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun read(context: Context): Index {
    val p = prefs(context)
    val kinds = (p.getStringSet(KEY_KINDS, emptySet()) ?: emptySet()).filter { it in FORM_KINDS }.toSet()
    val sensitive = (p.getStringSet(KEY_SENSITIVE, emptySet()) ?: emptySet()).filter { it in kinds }.toSet()
    return Index(kinds, sensitive)
  }

  fun write(context: Context, kinds: List<String>, sensitive: List<String>) {
    val k = kinds.filter { it in FORM_KINDS }.toSet()
    prefs(context).edit()
      .putStringSet(KEY_KINDS, HashSet(k))
      .putStringSet(KEY_SENSITIVE, HashSet(sensitive.filter { it in k }))
      .apply()
  }
}

/**
 * Which of a form's fields Hermit may offer to this requester, before any value exists: the kinds the profile has,
 * and never a sensitive one to an http page (Q92). The same rule as `planFill` in packages/core, which decides again.
 */
object Offer {
  fun <T> fields(fields: List<Pair<T, String>>, index: Index, origin: String?): List<Pair<T, String>> {
    if (origin == null) return emptyList()
    val secure = !origin.startsWith("http://")
    return fields.filter { (_, kind) -> kind in index.kinds && (secure || kind !in index.sensitive) }
  }
}
