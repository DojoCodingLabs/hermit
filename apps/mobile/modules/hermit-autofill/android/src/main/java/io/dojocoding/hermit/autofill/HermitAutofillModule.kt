package io.dojocoding.hermit.autofill

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.autofill.AutofillManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * SL-20, SL-35 and SL-36: what Hermit's JS reads and does. Whether Android supports autofill and Hermit is the selected
 * service, opening the setting, the profile index (kinds only), the login index (id hash, name, origins), the fill waiting for HM-FORM-01 and its answer, and,
 * in debuggable builds only, the last request's diagnostics.
 */
class HermitAutofillModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext) { "No React context" }

  /** After an answer, the user goes back to the app whose form it was. */
  private fun backToTheForm() {
    val activity = appContext.currentActivity ?: return
    activity.runOnUiThread { activity.moveTaskToBack(true) }
  }

  override fun definition() = ModuleDefinition {
    Name("HermitAutofill")

    /** { supported, selected, debug, sdk } */
    Function("status") {
      val afm = context.getSystemService(AutofillManager::class.java)
      mapOf(
        "supported" to (afm?.isAutofillSupported == true),
        "selected" to (afm?.hasEnabledAutofillServices() == true),
        "debug" to Diagnostics.enabled(context),
        "sdk" to Build.VERSION.SDK_INT,
      )
    }

    /**
     * Not selected: Android's "use Hermit for autofill?" picker. Selected (the picker would close at once): the
     * Passwords, passkeys and autofill page on Android 14 and later, else the settings home. Returns which one opened.
     */
    Function("openSettings") {
      val selected = context.getSystemService(AutofillManager::class.java)?.hasEnabledAutofillServices() == true
      val activity = appContext.currentActivity
      if (!selected && activity != null) {
        try {
          val picker = Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE, Uri.parse("package:${context.packageName}"))
          activity.startActivityForResult(picker, 4701)
          return@Function "picker"
        } catch (e: Exception) {
          // Some builds don't offer the picker; fall through to the settings pages.
        }
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        try {
          context.startActivity(Intent(Settings.ACTION_CREDENTIAL_PROVIDER).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          return@Function "credential_settings"
        } catch (e: Exception) {
          // Fall through.
        }
      }
      context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      "settings"
    }

    /** The kinds the profile can fill and which are sensitive (profileIndex in packages/core). Never a value. */
    Function("setProfileIndex") { kinds: List<String>, sensitive: List<String> ->
      ProfileIndex.write(context, kinds, sensitive)
    }

    /**
     * SL-36: the vault's logins as JSON (loginIndex in packages/core): each item's id hash, name and exact origins.
     * Never a username or a password; anything malformed is dropped (LoginIndex.parse).
     */
    Function("setLoginIndex") { json: String ->
      LoginIndex.write(context, json)
    }

    /** The fill waiting for HM-FORM-01, as JSON (who asks and which fields, never a value), or null when it ended. */
    Function("pendingFill") { id: String ->
      PendingFills.request(id)
    }

    /** Hands the approved values (by field key) to Android and goes back to the form. False when the request ended. */
    Function("completeFill") { id: String, values: Map<String, String> ->
      val ok = PendingFills.complete(id, values)
      if (ok) backToTheForm()
      ok
    }

    /** The user said no (or the cage refused): nothing is filled, and the user goes back to the form. */
    Function("cancelFill") { id: String ->
      val ok = PendingFills.cancel(id)
      if (ok) backToTheForm()
      ok
    }

    /** JSON of the last fill request (no values), or null. Debuggable builds only. */
    Function("lastRequest") {
      Diagnostics.lastRequest(context)
    }
  }
}
