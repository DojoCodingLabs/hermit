package io.dojocoding.hermit.night

import android.content.Context
import android.content.SharedPreferences
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * Q69: the stored wake plan and the WorkManager calls. The plan comes from nightWakePlan in @hermit/night;
 * nothing here decides what the night shift does, only when JavaScript is booted to decide it.
 */
internal object NightScheduler {
  const val WORK = "hermit-night-wake"
  private const val FILE = "hermit_night"

  const val SCHEDULED = "scheduled"
  const val START = "start_minute"
  const val END = "end_minute"
  const val PERIOD = "period_minutes"
  const val TITLE = "notify_title"
  const val TEXT = "notify_text"
  const val LAST_WAKE = "last_wake_at"
  const val LAST_STARTED = "last_started_at"
  const val LAST_BLOCKED = "last_blocked_at"
  const val LAST_FALLBACK = "last_fallback_at"

  fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun mark(context: Context, key: String) {
    prefs(context).edit().putLong(key, System.currentTimeMillis()).apply()
  }

  /** Periodic work while charging. The worker checks the window gate, so off-window wakes cost almost nothing. */
  fun enqueue(context: Context, periodMinutes: Long, policy: ExistingPeriodicWorkPolicy) {
    val constraints = Constraints.Builder().setRequiresCharging(true).build()
    val request = PeriodicWorkRequest.Builder(NightWakeWorker::class.java, periodMinutes.coerceAtLeast(15L), TimeUnit.MINUTES)
      .setConstraints(constraints)
      .addTag(WORK)
      .build()
    WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(WORK, policy, request)
  }

  fun cancel(context: Context) {
    WorkManager.getInstance(context.applicationContext).cancelUniqueWork(WORK)
  }

  /** Minutes since local midnight, in the phone's zone (the same zone the JavaScript side uses). */
  fun localMinute(): Int {
    val now = Calendar.getInstance()
    return now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
  }

  /** The same gate as wakeGateOpen in packages/night/src/wake.ts: [start, end), crossing midnight when start > end. */
  fun gateOpen(minute: Int, start: Int, end: Int): Boolean {
    if (start == end) return false
    return if (start < end) minute >= start && minute < end else minute >= start || minute < end
  }
}
