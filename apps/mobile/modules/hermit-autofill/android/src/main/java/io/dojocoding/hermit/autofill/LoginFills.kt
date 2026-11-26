package io.dojocoding.hermit.autofill

import android.app.assist.AssistStructure
import android.content.Context
import android.view.autofill.AutofillId
import org.json.JSONArray
import org.json.JSONObject

/**
 * SL-36: one login form as the vault sees it. Who asks (package, signing certificate digests and, from a trusted
 * browser, the page's domain and scheme), the exact origin the shared rule gives it or why none, the username and
 * password fields found, and the vault logins that store exactly that origin (`OriginMatch.loginsFor`). Never a value.
 */
data class LoginFill(
  val packageName: String,
  val certs: List<String>,
  val web: List<WebNode>,
  val origin: String?,
  val reason: String?,
  /** The fields to fill, in order: the username (if found), then the password (if found). */
  val fields: List<Pair<AutofillId, String>>,
  val entries: List<LoginEntry>,
)

object LoginFills {
  fun read(context: Context, structure: AssistStructure): LoginFill {
    val form = StructureParser.parse(structure)
    val fields = listOfNotNull(form.username?.let { it to "username" }, form.password?.let { it to "password" })
    if (fields.isEmpty()) return LoginFill(form.packageName, emptyList(), form.web, null, "no_login_fields", fields, emptyList())
    val certs = Requester.certDigests(context, form.packageName)
    val index = LoginIndex.read(context)
    val offer = OriginMatch.loginsFor(FillOrigin(form.packageName, certs, form.web), index, OriginMatch.TRUSTED_BROWSERS)
    val entries = offer.refs.mapNotNull { ref -> index.firstOrNull { it.ref == ref } }
    return LoginFill(form.packageName, certs, form.web, offer.origin, offer.reason, fields, entries)
  }

  /** The request HM-APPR-01 reads (NativeLoginRequest in packages/runtime/src/form-fill.ts): fields by position. */
  fun json(id: String, fill: LoginFill, ref: String, label: String?): String {
    val web = JSONArray()
    fill.web.forEach { web.put(JSONObject().put("domain", it.domain).put("scheme", it.scheme ?: JSONObject.NULL)) }
    val fields = JSONArray()
    fill.fields.forEachIndexed { i, f -> fields.put(JSONObject().put("key", i.toString()).put("kind", f.second)) }
    return JSONObject()
      .put("kind", "login")
      .put("id", id)
      .put("item", ref)
      .put("packageName", fill.packageName)
      .put("appLabel", label ?: JSONObject.NULL)
      .put("certDigests", JSONArray(fill.certs))
      .put("web", web)
      .put("origin", fill.origin ?: JSONObject.NULL)
      .put("fields", fields)
      .toString()
  }
}
