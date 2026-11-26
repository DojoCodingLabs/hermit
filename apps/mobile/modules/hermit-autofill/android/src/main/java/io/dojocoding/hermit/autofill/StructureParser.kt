package io.dojocoding.hermit.autofill

import android.app.assist.AssistStructure
import android.app.assist.AssistStructure.ViewNode
import android.os.Build
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import java.util.Locale

/** A login form as Android described it: who asks, the two fields Hermit would fill, and their web origins. */
data class ParsedForm(
  val packageName: String,
  val username: AutofillId?,
  val password: AutofillId?,
  /** The nearest web domain above the username and password fields; empty for a native form. */
  val web: List<WebNode>,
)

/** SL-35: one field the profile could fill, its kind, and the nearest web domain above it (null in a native form). */
data class ProfileField(val id: AutofillId, val kind: String, val web: WebNode?)

data class ProfileForm(val packageName: String, val fields: List<ProfileField>)

/**
 * SL-20: reads the AssistStructure of a fill request. It never reads a field's current value (ViewNode.getAutofillValue
 * may hold what the user typed); only the hints, input types, HTML attributes and ids that say what a field is.
 */
object StructureParser {
  private val USERNAME_WORDS = listOf("user", "email", "login", "correo", "usuario", "account", "cuenta")

  fun parse(structure: AssistStructure): ParsedForm {
    var username: Pair<AutofillId, WebNode?>? = null
    var password: Pair<AutofillId, WebNode?>? = null

    fun visit(node: ViewNode, inherited: WebNode?) {
      val domain = node.webDomain
      val here = if (!domain.isNullOrEmpty()) WebNode(domain, if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) node.webScheme else null) else inherited
      val id = node.autofillId
      if (id != null && node.autofillType == View.AUTOFILL_TYPE_TEXT) {
        when (kind(node)) {
          Kind.PASSWORD -> { if (password == null) password = id to here }
          Kind.USERNAME -> { if (username == null) username = id to here }
          Kind.OTHER -> {}
        }
      }
      for (i in 0 until node.childCount) visit(node.getChildAt(i), here)
    }

    for (w in 0 until structure.windowNodeCount) visit(structure.getWindowNodeAt(w).rootViewNode, null)

    return ParsedForm(
      packageName = structure.activityComponent.packageName,
      username = username?.first,
      password = password?.first,
      web = listOfNotNull(username?.second, password?.second),
    )
  }

  /**
   * SL-35: every text field Hermit's profile could fill, with its kind (FieldKinds, the mirror of packages/core) and
   * the nearest web domain above it. Password fields and fields of no known kind are left out. Never reads a value.
   */
  fun parseProfile(structure: AssistStructure): ProfileForm {
    val fields = ArrayList<ProfileField>()

    fun visit(node: ViewNode, inherited: WebNode?) {
      val domain = node.webDomain
      val here = if (!domain.isNullOrEmpty()) WebNode(domain, if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) node.webScheme else null) else inherited
      val id = node.autofillId
      if (id != null && node.autofillType == View.AUTOFILL_TYPE_TEXT) {
        val kind = FieldKinds.classify(describe(node))
        if (kind != null && kind != "password") fields.add(ProfileField(id, kind, here))
      }
      for (i in 0 until node.childCount) visit(node.getChildAt(i), here)
    }

    for (w in 0 until structure.windowNodeCount) visit(structure.getWindowNodeAt(w).rootViewNode, null)
    return ProfileForm(structure.activityComponent.packageName, fields)
  }

  /** What says what a field is: hints, HTML attributes (lowercase names), id, hint and input type. Never its value. */
  private fun describe(node: ViewNode): FieldDescriptor {
    val html = HashMap<String, String>()
    node.htmlInfo?.attributes?.forEach { a ->
      val name = a.first?.lowercase(Locale.ROOT)
      val value = a.second
      if (name != null && value != null && name !in html) html[name] = value
    }
    return FieldDescriptor(
      hints = node.autofillHints?.toList().orEmpty(),
      html = html,
      idEntry = node.idEntry,
      hint = node.hint,
      inputType = node.inputType,
    )
  }

  private enum class Kind { USERNAME, PASSWORD, OTHER }

  private fun kind(node: ViewNode): Kind {
    val hints = node.autofillHints?.map { it.lowercase(Locale.ROOT) }.orEmpty()
    if (hints.any { it.contains("password") }) return Kind.PASSWORD
    if (hints.any { it.contains("username") || it.contains("email") }) return Kind.USERNAME

    val html = node.htmlInfo?.attributes.orEmpty().associate { (it.first ?: "").lowercase(Locale.ROOT) to (it.second ?: "").lowercase(Locale.ROOT) }
    if (html["type"] == "password" || html["autocomplete"]?.contains("password") == true) return Kind.PASSWORD
    if (html["type"] == "email" || html["autocomplete"]?.let { it.contains("username") || it.contains("email") } == true) return Kind.USERNAME

    val type = node.inputType
    if ((type and InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_TEXT) {
      when (type and InputType.TYPE_MASK_VARIATION) {
        InputType.TYPE_TEXT_VARIATION_PASSWORD, InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD, InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD -> return Kind.PASSWORD
        InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS -> return Kind.USERNAME
      }
    }

    val words = listOfNotNull(node.idEntry, node.hint, html["name"], html["id"]).joinToString(" ").lowercase(Locale.ROOT)
    if (words.contains("password") || words.contains("contrase")) return Kind.PASSWORD
    return if (USERNAME_WORDS.any { words.contains(it) }) Kind.USERNAME else Kind.OTHER
  }
}
