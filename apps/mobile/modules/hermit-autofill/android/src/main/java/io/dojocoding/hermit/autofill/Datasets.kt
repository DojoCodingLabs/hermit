package io.dojocoding.hermit.autofill

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.IntentSender
import android.os.Build
import android.service.autofill.Dataset
import android.service.autofill.Field
import android.service.autofill.InlinePresentation
import android.service.autofill.Presentations
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import android.widget.inline.InlinePresentationSpec
import androidx.autofill.inline.UiVersions
import androidx.autofill.inline.v1.InlineSuggestionUi

/**
 * SL-20: one dataset in two states. Locked: the item's name, no values, and an authentication IntentSender, so
 * Android shows the suggestion but has nothing to fill until Hermit's activity returns the unlocked one. Unlocked:
 * the same fields with their values, returned only after the fingerprint (AutofillAuthActivity).
 */
object Datasets {
  fun menu(context: Context, title: String): RemoteViews =
    RemoteViews(context.packageName, R.layout.hermit_autofill_item).apply { setTextViewText(R.id.hermit_autofill_text, title) }

  /** The keyboard's inline chip (Android 11 and later), or null when the keyboard's spec is not v1 inline UI. */
  fun inline(context: Context, spec: InlinePresentationSpec?, title: String): InlinePresentation? {
    if (spec == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
    if (!UiVersions.getVersions(spec.style).contains(UiVersions.INLINE_UI_VERSION_1)) return null
    // The long-press attribution: opens Hermit's own autofill screen. Immutable, it carries nothing.
    val attribution = PendingIntent.getActivity(
      context,
      0,
      Intent(context, AutofillSettingsActivity::class.java),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val content = InlineSuggestionUi.newContentBuilder(attribution).setTitle(title).setContentDescription(title).build()
    return InlinePresentation(content.slice, spec, false)
  }

  /** `values` null: locked (needs `auth`). Otherwise each id gets its value. */
  @SuppressLint("NewApi")
  fun build(
    context: Context,
    ids: List<AutofillId>,
    values: Map<AutofillId, String>?,
    title: String,
    inline: InlinePresentation?,
    auth: IntentSender?,
  ): Dataset {
    val menu = menu(context, title)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      val presentations = Presentations.Builder().setMenuPresentation(menu)
      if (inline != null) presentations.setInlinePresentation(inline)
      val builder = Dataset.Builder(presentations.build())
      for (id in ids) {
        val field = Field.Builder()
        values?.get(id)?.let { field.setValue(AutofillValue.forText(it)) }
        builder.setField(id, field.build())
      }
      if (auth != null) builder.setAuthentication(auth)
      return builder.build()
    }
    @Suppress("DEPRECATION")
    val builder = Dataset.Builder(menu)
    if (inline != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      @Suppress("DEPRECATION")
      builder.setInlinePresentation(inline)
    }
    for (id in ids) {
      @Suppress("DEPRECATION")
      builder.setValue(id, values?.get(id)?.let { AutofillValue.forText(it) })
    }
    if (auth != null) builder.setAuthentication(auth)
    return builder.build()
  }
}
