package io.dojocoding.hermit.autofill

import android.content.Context
import android.content.SharedPreferences
import android.content.pm.ApplicationInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * The autofill debug screen's diagnostics (hermit://autofill-debug), in debuggable builds only: what the last fill
 * request looked like (package, certificate digests, web domains and schemes, the kinds of fields found, the verdict)
 * and how the approval ended. Never a field's value. The file name is the SL-20 spike's, which Delete everything
 * already removes (NATIVE_PREFERENCES in packages/core/src/erase.ts).
 */
object Diagnostics {
  private const val FILE = "hermit_autofill_spike"
  private const val KEY_LAST = "last_request"

  fun enabled(context: Context): Boolean = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

  private fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun recordRequest(context: Context, packageName: String, certs: List<String>, web: List<WebNode>, kinds: List<String>, origin: String?, reason: String?, inline: Boolean, offered: Int, logins: Int = 0) {
    if (!enabled(context)) return
    val webArr = JSONArray()
    web.forEach { webArr.put(JSONObject().put("domain", it.domain).put("scheme", it.scheme ?: JSONObject.NULL)) }
    val json = JSONObject()
      .put("at", System.currentTimeMillis())
      .put("packageName", packageName)
      .put("certDigests", JSONArray(certs))
      .put("web", webArr)
      .put("fields", JSONArray(kinds))
      .put("inline", inline)
      .put("origin", origin ?: JSONObject.NULL)
      .put("reason", reason ?: JSONObject.NULL)
      .put("offered", offered)
      .put("logins", logins)
      .put("auth", JSONObject.NULL)
    prefs(context).edit().putString(KEY_LAST, json.toString()).apply()
  }

  /** How the last approval ended: sent_to_hermit, filled, denied, expired, no_structure, origin_changed, nothing_to_fill, no_login. */
  fun recordAuth(context: Context, outcome: String) {
    if (!enabled(context)) return
    val last = prefs(context).getString(KEY_LAST, null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()
    prefs(context).edit().putString(KEY_LAST, last.put("auth", outcome).put("authAt", System.currentTimeMillis()).toString()).apply()
  }

  fun lastRequest(context: Context): String? = if (enabled(context)) prefs(context).getString(KEY_LAST, null) else null
}
