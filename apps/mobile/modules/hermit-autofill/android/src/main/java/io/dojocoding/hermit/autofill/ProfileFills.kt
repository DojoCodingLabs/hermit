package io.dojocoding.hermit.autofill

import android.app.assist.AssistStructure
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * SL-35: one form as the profile sees it. Who asks (package, signing certificate digests and, from a trusted browser,
 * the web page's domain and scheme), the exact origin the shared rule gives it or why none, and the fields Hermit may
 * offer: the kinds the profile has, never a sensitive one to an http page. Never a value.
 */
data class ProfileFill(
  val packageName: String,
  val certs: List<String>,
  val web: List<WebNode>,
  val origin: String?,
  val reason: String?,
  val fields: List<ProfileField>,
  /** Every kind found, for the debug diagnostics. */
  val found: List<String>,
)

object ProfileFills {
  const val MAX_FIELDS = 64

  fun read(context: Context, structure: AssistStructure): ProfileFill {
    val form = StructureParser.parseProfile(structure)
    val index = ProfileIndex.read(context)
    val known = form.fields.filter { it.kind in index.kinds }
    val certs = Requester.certDigests(context, form.packageName)
    val web = known.mapNotNull { it.web }
    val (origin, reason) = OriginMatch.requestOrigin(FillOrigin(form.packageName, certs, web), OriginMatch.TRUSTED_BROWSERS)
    // At most MAX_FIELDS, the same cap as the runtime (FILL_MAX_FIELDS in packages/runtime/src/form-fill.ts).
    val offered = Offer.fields(known.map { it to it.kind }, index, origin).map { it.first }.take(MAX_FIELDS)
    return ProfileFill(form.packageName, certs, web, origin, reason, offered, form.fields.map { it.kind })
  }

  /** The request HM-FORM-01 reads (NativeFillRequest in packages/runtime/src/form-fill.ts): fields by position. */
  fun json(id: String, fill: ProfileFill, label: String?): String {
    val web = JSONArray()
    fill.web.forEach { web.put(JSONObject().put("domain", it.domain).put("scheme", it.scheme ?: JSONObject.NULL)) }
    val fields = JSONArray()
    fill.fields.forEachIndexed { i, f -> fields.put(JSONObject().put("key", i.toString()).put("kind", f.kind)) }
    return JSONObject()
      .put("id", id)
      .put("packageName", fill.packageName)
      .put("appLabel", label ?: JSONObject.NULL)
      .put("certDigests", JSONArray(fill.certs))
      .put("web", web)
      .put("origin", fill.origin ?: JSONObject.NULL)
      .put("fields", fields)
      .toString()
  }
}
