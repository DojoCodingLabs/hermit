package io.dojocoding.hermit.night

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Q69: the foreground service that runs one night pass. It shows a small ongoing notice, then hands over to
 * React Native's HeadlessJsTaskService, which boots JavaScript without a screen, runs the HermitNightShift
 * task and stops the service when the task finishes (or times out).
 */
class NightService : HeadlessJsTaskService() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), type)
    } catch (e: Exception) {
      // Android refused the foreground start after all (Android 12+ background rules, or a missing type permission).
      Log.w(TAG, "startForeground refused", e)
      NightScheduler.mark(this, NightScheduler.LAST_BLOCKED)
      stopSelf()
      return START_NOT_STICKY
    }
    running = true
    super.onStartCommand(intent, flags, startId)
    // A pass killed by the system is picked up by the next wake, never restarted outside the window.
    return START_NOT_STICKY
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig = NightJs.config(NightJs.SERVICE_TIMEOUT_MS)

  /** Android 15: a dataSync service past its daily allowance must stop. The next night resumes the briefing. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    Log.w(TAG, "foreground service timed out")
    stopSelf()
  }

  override fun onDestroy() {
    running = false
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun notification(): Notification {
    val prefs = NightScheduler.prefs(this)
    val title = prefs.getString(NightScheduler.TITLE, null) ?: "Hermit"
    val text = prefs.getString(NightScheduler.TEXT, null) ?: ""
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL) == null) {
        manager.createNotificationChannel(NotificationChannel(CHANNEL, title, NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
      }
    }
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  companion object {
    private const val TAG = "HermitNight"
    private const val CHANNEL = "hermit-night"
    private const val NOTIFICATION_ID = 4711

    /** True while a pass runs, so a wake in the meantime doesn't start a second one. */
    @Volatile
    var running = false
  }
}
