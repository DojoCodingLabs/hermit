package io.dojocoding.hermit.night

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.work.ExistingPeriodicWorkPolicy
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Q69: schedules, cancels and reports the night wake. HM-NIGHT-01 reads status() for its background line. */
class HermitNightModule : Module() {
  private val context: Context get() = requireNotNull(appContext.reactContext) { "No React context" }

  override fun definition() = ModuleDefinition {
    Name("HermitNight")

    /** Stores the plan and enqueues (UPDATE: one unique periodic work, its timing kept when only the gate changed). */
    Function("schedule") { startMinute: Int, endMinute: Int, periodMinutes: Int, title: String, text: String ->
      NightScheduler.prefs(context).edit()
        .putBoolean(NightScheduler.SCHEDULED, true)
        .putInt(NightScheduler.START, startMinute)
        .putInt(NightScheduler.END, endMinute)
        .putInt(NightScheduler.PERIOD, periodMinutes)
        .putString(NightScheduler.TITLE, title)
        .putString(NightScheduler.TEXT, text)
        .apply()
      NightScheduler.enqueue(context, periodMinutes.toLong(), ExistingPeriodicWorkPolicy.UPDATE)
    }

    Function("cancel") {
      NightScheduler.prefs(context).edit().putBoolean(NightScheduler.SCHEDULED, false).apply()
      NightScheduler.cancel(context)
    }

    /** SL-26 (Delete everything): no schedule, no running service, and no native preferences left behind. */
    Function("stopAll") {
      NightScheduler.cancel(context)
      context.stopService(Intent(context, NightService::class.java))
      NightScheduler.prefs(context).edit().clear().commit()
    }

    Function("status") {
      val prefs = NightScheduler.prefs(context)
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      fun time(key: String): Double? = prefs.getLong(key, 0L).takeIf { it > 0L }?.toDouble()
      mapOf(
        "scheduled" to prefs.getBoolean(NightScheduler.SCHEDULED, false),
        "startMinute" to prefs.getInt(NightScheduler.START, -1),
        "endMinute" to prefs.getInt(NightScheduler.END, -1),
        "periodMinutes" to prefs.getInt(NightScheduler.PERIOD, 0),
        "title" to prefs.getString(NightScheduler.TITLE, null),
        "ignoringBatteryOptimizations" to pm.isIgnoringBatteryOptimizations(context.packageName),
        "notificationsAllowed" to NotificationManagerCompat.from(context).areNotificationsEnabled(),
        "lastWakeAt" to time(NightScheduler.LAST_WAKE),
        "lastStartedAt" to time(NightScheduler.LAST_STARTED),
        "lastBlockedAt" to time(NightScheduler.LAST_BLOCKED),
        "lastFallbackAt" to time(NightScheduler.LAST_FALLBACK),
      )
    }

    /**
     * Opens Android's battery optimization list (no special permission; the user picks Hermit there), or the
     * app's own settings page when a phone has no such list. Offered on HM-NIGHT-01, never required.
     */
    Function("openBatterySettings") {
      val intents = listOf(
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")),
      )
      intents.any { intent ->
        try {
          context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          true
        } catch (e: ActivityNotFoundException) {
          false
        }
      }
    }
  }
}
