package io.dojocoding.hermit.night

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * The headless task registered in apps/mobile/index.ts. All night logic is TypeScript; this only boots React
 * Native without a screen and runs the task. Allowed in the foreground: when the app is open in the same
 * JavaScript context the task reuses the live runtime, and the run lock keeps it to one pass.
 */
internal object NightJs {
  const val TASK = "HermitNightShift"
  /** The service's pass; the run lock in JavaScript expires on its own if the process dies first. */
  const val SERVICE_TIMEOUT_MS = 50L * 60_000L
  /** Inside a worker: WorkManager stops workers after ten minutes. */
  const val WORKER_TIMEOUT_MS = 9L * 60_000L

  fun config(timeoutMs: Long): HeadlessJsTaskConfig = HeadlessJsTaskConfig(TASK, Arguments.createMap(), timeoutMs, true)

  /** Runs the task in this process and waits for it (the worker fallback). Must not be called on the main thread. */
  fun runAndWait(context: Context, timeoutMs: Long): Boolean {
    val app = context.applicationContext as? ReactApplication ?: return false
    val host = app.reactHost ?: return false
    val done = CountDownLatch(1)
    val ours = AtomicInteger(-1)

    // Runs on the main thread; the finish event is posted to it later, so `ours` is set before it arrives.
    fun start(reactContext: ReactContext) {
      val tasks = HeadlessJsTaskContext.getInstance(reactContext)
      tasks.addTaskEventListener(object : HeadlessJsTaskEventListener {
        override fun onHeadlessJsTaskStart(taskId: Int) = Unit
        override fun onHeadlessJsTaskFinish(taskId: Int) {
          if (taskId != ours.get()) return
          tasks.removeTaskEventListener(this)
          done.countDown()
        }
      })
      ours.set(tasks.startTask(config(timeoutMs - 30_000L)))
    }

    Handler(Looper.getMainLooper()).post {
      try {
        val current = host.currentReactContext
        if (current != null) {
          start(current)
        } else {
          host.addReactInstanceEventListener(object : ReactInstanceEventListener {
            override fun onReactContextInitialized(context: ReactContext) {
              host.removeReactInstanceEventListener(this)
              Handler(Looper.getMainLooper()).post {
                try {
                  start(context)
                } catch (e: Exception) {
                  Log.w("HermitNight", "headless task failed to start", e)
                  done.countDown()
                }
              }
            }
          })
          host.start()
        }
      } catch (e: Exception) {
        Log.w("HermitNight", "React Native failed to start headless", e)
        done.countDown()
      }
    }
    return try {
      done.await(timeoutMs, TimeUnit.MILLISECONDS)
    } catch (e: InterruptedException) {
      false
    }
  }
}
