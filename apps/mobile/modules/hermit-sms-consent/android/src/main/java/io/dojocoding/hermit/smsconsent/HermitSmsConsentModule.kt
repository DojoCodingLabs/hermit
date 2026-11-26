package io.dojocoding.hermit.smsconsent

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * SL-56b (Q138): Google's SMS User Consent API for a web task's one-time code. No SMS permission.
 *
 * - start: SmsRetriever.startSmsUserConsent(null) at the sign-in click. Android then listens up to five minutes for
 *   one message with a 4 to 10 character code from a sender not in the contacts, and broadcasts a consent intent.
 *   The broadcast is only kept (with the time it arrived); nothing is shown or read yet.
 * - next: only when the task is paused at its code step. It waits for the kept consent intent (or up to `timeoutMs`),
 *   then opens Android's dialog, which shows the one message. Allow resolves the message text; Deny resolves
 *   "refused"; nothing in time resolves "none". The text is handed to JavaScript once and not kept here.
 * - stop: unregisters the receiver and drops anything kept. Every call after it resolves "none".
 * One listener at a time: a new start replaces the old one.
 */
class HermitSmsConsentModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext) { "No React context" }
  private val main = Handler(Looper.getMainLooper())
  private var receiver: BroadcastReceiver? = null
  private var consent: Intent? = null
  private var receivedAt = 0L
  private var timedOut = false
  private var waiting: Promise? = null
  private var waitTimeout: Runnable? = null
  private var showing: Promise? = null
  private var showingAt = 0L

  private fun resolveWaiting(value: Any?) {
    waitTimeout?.let { main.removeCallbacks(it) }
    waitTimeout = null
    val p = waiting
    waiting = null
    p?.resolve(value)
  }

  private fun none() = mapOf("kind" to "none")

  private fun show(intent: Intent, at: Long, promise: Promise) {
    val activity = appContext.currentActivity
    if (activity == null) {
      promise.resolve(none())
      return
    }
    consent = null
    showing = promise
    showingAt = at
    try {
      activity.startActivityForResult(intent, REQUEST_CODE)
    } catch (e: Exception) {
      showing = null
      promise.resolve(none())
    }
  }

  private fun stopAll() {
    receiver?.let { runCatching { context.unregisterReceiver(it) } }
    receiver = null
    consent = null
    timedOut = false
    resolveWaiting(none())
    showing?.resolve(none())
    showing = null
  }

  override fun definition() = ModuleDefinition {
    Name("HermitSmsConsent")

    AsyncFunction("start") { promise: Promise ->
      stopAll()
      val r = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
          if (intent.action != SmsRetriever.SMS_RETRIEVED_ACTION) return
          val extras = intent.extras ?: return
          @Suppress("DEPRECATION")
          val status = extras.get(SmsRetriever.EXTRA_STATUS) as? Status ?: return
          when (status.statusCode) {
            CommonStatusCodes.SUCCESS -> {
              @Suppress("DEPRECATION")
              val ask = (if (Build.VERSION.SDK_INT >= 33) extras.getParcelable(SmsRetriever.EXTRA_CONSENT_INTENT, Intent::class.java)
                else extras.getParcelable(SmsRetriever.EXTRA_CONSENT_INTENT)) ?: return
              val at = System.currentTimeMillis()
              val p = waiting
              if (p != null) {
                waitTimeout?.let { main.removeCallbacks(it) }
                waitTimeout = null
                waiting = null
                show(ask, at, p)
              } else {
                consent = ask
                receivedAt = at
              }
            }
            CommonStatusCodes.TIMEOUT -> {
              timedOut = true
              resolveWaiting(none())
            }
          }
        }
      }
      try {
        // The broadcast comes from Play services, guarded by its permission; exported so Play services can reach it.
        ContextCompat.registerReceiver(context, r, IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION), SmsRetriever.SEND_PERMISSION, null, ContextCompat.RECEIVER_EXPORTED)
        receiver = r
        SmsRetriever.getClient(context).startSmsUserConsent(null)
          .addOnSuccessListener { promise.resolve(true) }
          .addOnFailureListener {
            stopAll()
            promise.resolve(false)
          }
      } catch (e: Throwable) {
        // No Play services (or no SMS retriever on this phone): no SMS codes, the user types them.
        stopAll()
        promise.resolve(false)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("next") { timeoutMs: Double, promise: Promise ->
      if (receiver == null || timedOut || waiting != null || showing != null) {
        promise.resolve(none())
        return@AsyncFunction
      }
      val kept = consent
      if (kept != null) {
        show(kept, receivedAt, promise)
        return@AsyncFunction
      }
      waiting = promise
      val t = Runnable { resolveWaiting(none()) }
      waitTimeout = t
      main.postDelayed(t, timeoutMs.toLong().coerceIn(0L, 300_000L))
    }.runOnQueue(Queues.MAIN)

    Function("stop") { main.post { stopAll() } }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_CODE) return@OnActivityResult
      val p = showing ?: return@OnActivityResult
      showing = null
      val text = payload.data?.getStringExtra(SmsRetriever.EXTRA_SMS_MESSAGE)
      // One message per listener: it is done either way.
      receiver?.let { runCatching { context.unregisterReceiver(it) } }
      receiver = null
      if (payload.resultCode == Activity.RESULT_OK && text != null) {
        p.resolve(mapOf("kind" to "message", "text" to text, "receivedAt" to showingAt.toDouble()))
      } else {
        p.resolve(mapOf("kind" to "refused"))
      }
    }

    OnDestroy { main.post { stopAll() } }
  }

  companion object {
    const val REQUEST_CODE = 5602
  }
}
