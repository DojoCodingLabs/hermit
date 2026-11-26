package io.dojocoding.hermit.autofill

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.widget.inline.InlinePresentationSpec
import java.util.concurrent.atomic.AtomicInteger

/**
 * SL-20, SL-35 and SL-36: Hermit as Android's autofill service. Android binds it only after the user picks Hermit in
 * the autofill settings. On a fill request it works out who asks (package, signing certificate and, for a trusted
 * browser, the web origin) and offers locked datasets, a title and no values, only on an exact origin:
 * - SL-36: one per vault login that stores exactly that origin (at most five), titled with the login's name;
 * - SL-35: one for the fields Hermit's profile could fill.
 * Tapping one starts AutofillAuthActivity, which hands the request to Hermit's approval sheet (HM-APPR-01 for a login,
 * HM-FORM-01 for a profile form, Q79); values exist only after the cage and the user approve there.
 */
class HermitAutofillService : AutofillService() {
  override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
    try {
      callback.onSuccess(respond(request))
    } catch (e: Exception) {
      // Fail closed: an unexpected structure gets no suggestion, never a partial one.
      callback.onSuccess(null)
    }
  }

  private fun respond(request: FillRequest): FillResponse? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
    val structure = request.fillContexts.lastOrNull()?.structure ?: return null
    if (structure.activityComponent.packageName == packageName) return null // Hermit's own screens are never filled by Hermit.
    val specs = request.inlineSuggestionsRequest?.inlinePresentationSpecs.orEmpty()
    // The keyboard gives one spec per suggestion slot; the last one applies to any further suggestion.
    fun spec(i: Int): InlinePresentationSpec? = if (specs.isEmpty()) null else specs[minOf(i, specs.size - 1)]
    val datasets = ArrayList<Dataset>()

    // SL-36: the vault's logins for exactly this requester, each a locked dataset that carries the login's id hash.
    val login = LoginFills.read(this, structure)
    val loginOrigin = login.origin
    if (loginOrigin != null) {
      for (entry in login.entries) {
        val auth = Intent(this, AutofillAuthActivity::class.java)
          .putExtra(AutofillAuthActivity.EXTRA_ORIGIN, loginOrigin)
          .putExtra(AutofillAuthActivity.EXTRA_ITEM, entry.ref)
        val title = getString(R.string.hermit_autofill_login, entry.name)
        datasets.add(Datasets.build(this, login.fields.map { it.first }, null, title, Datasets.inline(this, spec(datasets.size), title), sender(auth)))
      }
    }

    // SL-35: the profile's fields.
    val fill = ProfileFills.read(this, structure)
    Diagnostics.recordRequest(this, fill.packageName, fill.certs, fill.web, fill.found, fill.origin, fill.reason, specs.isNotEmpty(), fill.fields.size, login.entries.size)
    val origin = fill.origin
    if (origin != null && fill.fields.isNotEmpty()) {
      val auth = Intent(this, AutofillAuthActivity::class.java).putExtra(AutofillAuthActivity.EXTRA_ORIGIN, origin)
      val title = getString(R.string.hermit_autofill_dataset)
      datasets.add(Datasets.build(this, fill.fields.map { it.id }, null, title, Datasets.inline(this, spec(datasets.size), title), sender(auth)))
    }

    if (datasets.isEmpty()) return null
    val response = FillResponse.Builder()
    datasets.forEach { response.addDataset(it) }
    return response.build()
  }

  /**
   * Mutable on purpose: Android adds EXTRA_ASSIST_STRUCTURE when it fires it (Dataset.setAuthentication says so). The
   * intent is explicit, to Hermit's own non-exported activity, and each gets its own request code so the extras of
   * one suggestion never replace another's.
   */
  private fun sender(auth: Intent) =
    PendingIntent.getActivity(this, requestCodes.incrementAndGet(), auth, PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_MUTABLE).intentSender

  /** Hermit never saves from a form: the profile is edited in Hermit (HM-FORM-02), and logins in the vault (SL-33). */
  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    callback.onSuccess()
  }

  companion object {
    private val requestCodes = AtomicInteger(0)
  }
}
