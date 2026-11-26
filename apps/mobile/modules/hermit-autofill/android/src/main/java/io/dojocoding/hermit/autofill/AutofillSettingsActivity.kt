package io.dojocoding.hermit.autofill

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/**
 * The settings link Android shows next to Hermit in the autofill picker and on a long-pressed inline chip. It opens
 * Hermit's personal profile (hermit://profile, HM-FORM-02), or the autofill debug screen (hermit://autofill-debug) in
 * debuggable builds; it takes no input from the caller.
 */
class AutofillSettingsActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val target = if (Diagnostics.enabled(this)) "hermit://autofill-debug" else "hermit://profile"
    val open = Intent(Intent.ACTION_VIEW, Uri.parse(target)).setPackage(packageName)
    try {
      startActivity(open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: Exception) {
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        try {
          startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e2: Exception) {
          // Nothing to open; just close.
        }
      }
    }
    finish()
  }
}
