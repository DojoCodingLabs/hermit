package io.dojocoding.hermit.night

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.ExistingPeriodicWorkPolicy

/**
 * Q69: after a reboot or an app update, re-enqueue the stored plan (KEEP: an existing schedule is left as is)
 * or make sure nothing is scheduled when the night shift is off. No JavaScript runs here.
 */
class NightBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val prefs = NightScheduler.prefs(context)
    if (prefs.getBoolean(NightScheduler.SCHEDULED, false)) {
      NightScheduler.enqueue(context, prefs.getInt(NightScheduler.PERIOD, 15).toLong(), ExistingPeriodicWorkPolicy.KEEP)
    } else {
      NightScheduler.cancel(context)
    }
  }
}
