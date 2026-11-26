package io.dojocoding.hermit.autofill

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * SL-36: the vault's logins as the service may know them before anything is approved, written by Hermit's JS
 * (`loginIndex` in packages/core) whenever the vault's items change: each item's id hash, its name and its exact
 * origins. Never a username, a password or a note, and never the item's id. It lives in the same private file as the
 * profile index (`hermit_autofill`), which Delete everything removes (NATIVE_PREFERENCES in packages/core/src/erase.ts).
 */
object LoginIndex {
  private const val KEY = "logins"

  /** A sane bound on what one index holds (the vault has no hard cap; this only guards the parse). */
  private const val MAX_ENTRIES = 5_000
  private const val MAX_ORIGINS = 20
  private const val MAX_NAME = 120
  private val REF = Regex("^[0-9a-f]{64}$")

  private fun prefs(context: Context) = context.getSharedPreferences(ProfileIndex.FILE, Context.MODE_PRIVATE)

  fun read(context: Context): List<LoginEntry> = parse(prefs(context).getString(KEY, null))

  /** Keeps only well-formed entries: a 64 hex ref, a name, and origins in exact canonical form. Anything else is dropped. */
  fun parse(json: String?): List<LoginEntry> {
    if (json.isNullOrEmpty()) return emptyList()
    val arr = try {
      JSONArray(json)
    } catch (e: Exception) {
      return emptyList()
    }
    val out = ArrayList<LoginEntry>()
    for (i in 0 until minOf(arr.length(), MAX_ENTRIES)) {
      val o = arr.optJSONObject(i) ?: continue
      val ref = o.optString("ref")
      val name = o.optString("name").take(MAX_NAME)
      val list = o.optJSONArray("origins") ?: continue
      val origins = (0 until minOf(list.length(), MAX_ORIGINS))
        .mapNotNull { list.optString(it, "").takeIf { s -> s.isNotEmpty() } }
        .filter { OriginMatch.normalize(it) == it }
      if (REF.matches(ref) && name.isNotBlank() && origins.isNotEmpty()) out.add(LoginEntry(ref, name, origins))
    }
    return out
  }

  fun write(context: Context, json: String) {
    val arr = JSONArray()
    parse(json).forEach { e -> arr.put(JSONObject().put("ref", e.ref).put("name", e.name).put("origins", JSONArray(e.origins))) }
    prefs(context).edit().putString(KEY, arr.toString()).apply()
  }
}
