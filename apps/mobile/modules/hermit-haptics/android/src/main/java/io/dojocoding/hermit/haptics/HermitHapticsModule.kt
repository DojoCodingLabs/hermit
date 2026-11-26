package io.dojocoding.hermit.haptics

import android.view.HapticFeedbackConstants
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The polish round's touch feedback (docs/design/polish/decisions.md): the system's own haptic constants on the
 * activity's window, so it needs no permission and follows the phone's "Touch feedback" setting. Android 13 is
 * Hermit's floor, so CONFIRM and REJECT (API 30) are always there.
 */
class HermitHapticsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HermitHaptics")

    /** "confirm" (an approval went through), "reject" (a no), "tick" (a primary press, a segment changing). */
    AsyncFunction("perform") { kind: String ->
      val view = appContext.currentActivity?.window?.decorView ?: return@AsyncFunction false
      val constant = when (kind) {
        "confirm" -> HapticFeedbackConstants.CONFIRM
        "reject" -> HapticFeedbackConstants.REJECT
        else -> HapticFeedbackConstants.CLOCK_TICK
      }
      view.performHapticFeedback(constant)
    }.runOnQueue(Queues.MAIN)
  }
}
