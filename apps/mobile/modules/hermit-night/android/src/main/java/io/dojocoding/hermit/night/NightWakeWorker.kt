package io.dojocoding.hermit.night

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters

/**
 * Q69: woken by WorkManager while the phone charges. Inside the night gate it starts NightService, the
 * foreground service that runs one night pass in headless JavaScript. Android 12+ refuses that start from the
 * background while battery optimization is on for Hermit (ForegroundServiceStartNotAllowedException, an
 * IllegalStateException); then the pass runs inside this worker instead, within WorkManager's time limit,
 * and the refusal is recorded so HM-NIGHT-01 can say so.
 */
class NightWakeWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val context = applicationContext
    val prefs = NightScheduler.prefs(context)
    if (!prefs.getBoolean(NightScheduler.SCHEDULED, false)) return Result.success()
    val start = prefs.getInt(NightScheduler.START, -1)
    val end = prefs.getInt(NightScheduler.END, -1)
    if (start < 0 || end < 0 || !NightScheduler.gateOpen(NightScheduler.localMinute(), start, end)) return Result.success()
    if (NightService.running) return Result.success()
    NightScheduler.mark(context, NightScheduler.LAST_WAKE)
    try {
      ContextCompat.startForegroundService(context, Intent(context, NightService::class.java))
      NightScheduler.mark(context, NightScheduler.LAST_STARTED)
    } catch (e: IllegalStateException) {
      Log.w(TAG, "foreground service refused, running the night pass in the worker", e)
      NightScheduler.mark(context, NightScheduler.LAST_BLOCKED)
      if (NightJs.runAndWait(context, NightJs.WORKER_TIMEOUT_MS)) NightScheduler.mark(context, NightScheduler.LAST_FALLBACK)
    } catch (e: SecurityException) {
      Log.w(TAG, "foreground service refused (permission)", e)
      NightScheduler.mark(context, NightScheduler.LAST_BLOCKED)
    }
    return Result.success()
  }

  private companion object {
    const val TAG = "HermitNight"
  }
}
