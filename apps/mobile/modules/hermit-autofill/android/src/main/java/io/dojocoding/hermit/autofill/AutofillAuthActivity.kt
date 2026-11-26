package io.dojocoding.hermit.autofill

import android.app.Activity
import android.app.assist.AssistStructure
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager

/**
 * SL-35 and SL-36 (Q79): the dataset's authentication. Android starts it over the other app when the user taps one of
 * Hermit's locked suggestions, with the form's AssistStructure. It parses the form again and checks the origin again
 * (the page may have navigated since the suggestion was shown), then hands the request to Hermit's own approval sheet
 * (hermit://fill: HM-FORM-01 for a profile form, HM-APPR-01 for a login) and waits. Hermit's cage decides; the user
 * approves there (a login with the approval key's signature and then the vault's fingerprint, a sensitive profile
 * field with the vault's fingerprint), and the module hands back the approved values, which become the dataset
 * Android fills. Any other outcome (a no, a timeout, a changed origin, a login that no longer stores this origin,
 * nothing to fill) returns RESULT_CANCELED and nothing is filled. Hermit never submits the form.
 */
class AutofillAuthActivity : Activity() {
  private val handler = Handler(Looper.getMainLooper())
  private var requestId: String? = null
  /** The fields to fill, by position: the keys Hermit's values come back under. */
  private var ids: List<AutofillId> = emptyList()
  private var ended = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return end("disabled")
    val structure = structure() ?: return end("no_structure")
    val offered = intent.getStringExtra(EXTRA_ORIGIN)
    val item = intent.getStringExtra(EXTRA_ITEM)
    if (item != null) startLogin(structure, offered, item) else startProfile(structure, offered)
  }

  private fun startProfile(structure: AssistStructure, offered: String?) {
    val fill = ProfileFills.read(this, structure)
    val origin = fill.origin
    if (origin == null || origin != offered) return end("origin_changed")
    if (fill.fields.isEmpty()) return end("nothing_to_fill")
    ids = fill.fields.map { it.id }
    val label = Requester.label(this, fill.packageName)
    send(PendingFills.add(this) { rid -> ProfileFills.json(rid, fill, label) })
  }

  /** SL-36: the login the user picked must still be stored for exactly this requester's origin. */
  private fun startLogin(structure: AssistStructure, offered: String?, item: String) {
    val fill = LoginFills.read(this, structure)
    val origin = fill.origin
    if (origin == null || origin != offered) return end("origin_changed")
    if (fill.fields.isEmpty() || fill.entries.none { it.ref == item }) return end("no_login")
    ids = fill.fields.map { it.first }
    val label = Requester.label(this, fill.packageName)
    send(PendingFills.add(this) { rid -> LoginFills.json(rid, fill, item, label) })
  }

  private fun send(id: String) {
    requestId = id
    handler.postDelayed({ end("expired") }, TTL_MS)
    try {
      val open = Intent(Intent.ACTION_VIEW, Uri.parse("hermit://fill?request=$id")).setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      startActivity(open)
      Diagnostics.recordAuth(this, "sent_to_hermit")
    } catch (e: Exception) {
      end("no_hermit")
    }
  }

  /** The approved values, by field position, from Hermit's sheet. */
  fun deliver(values: Map<String, String>) {
    if (ended) return
    val byId = LinkedHashMap<AutofillId, String>()
    ids.forEachIndexed { i, id -> values[i.toString()]?.let { byId[id] = it } }
    if (byId.isEmpty()) return end("nothing_to_fill")
    val dataset = Datasets.build(this, byId.keys.toList(), byId, getString(R.string.hermit_autofill_dataset), null, null)
    ended = true
    handler.removeCallbacksAndMessages(null)
    Diagnostics.recordAuth(this, "filled")
    setResult(RESULT_OK, Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset))
    finish()
  }

  /** The user said no on Hermit's sheet, or the cage refused. */
  fun declined() = end("denied")

  private fun end(outcome: String) {
    if (ended) return
    ended = true
    handler.removeCallbacksAndMessages(null)
    requestId?.let { PendingFills.remove(it) }
    Diagnostics.recordAuth(this, outcome)
    setResult(RESULT_CANCELED)
    finish()
  }

  private fun structure(): AssistStructure? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(AutofillManager.EXTRA_ASSIST_STRUCTURE, AssistStructure::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra<AssistStructure>(AutofillManager.EXTRA_ASSIST_STRUCTURE)
    }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    requestId?.let { PendingFills.remove(it) }
    super.onDestroy()
  }

  companion object {
    const val EXTRA_ORIGIN = "io.dojocoding.hermit.autofill.ORIGIN"

    /** SL-36: the vault login the user picked, by its id hash. */
    const val EXTRA_ITEM = "io.dojocoding.hermit.autofill.ITEM"

    /** A little longer than Hermit's own preview (FILL_TTL_MS in packages/runtime), so Hermit expires it first. */
    const val TTL_MS = 150_000L
  }
}
