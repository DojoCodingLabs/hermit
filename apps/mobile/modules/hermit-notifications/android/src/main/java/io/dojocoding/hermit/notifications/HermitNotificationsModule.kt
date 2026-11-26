package io.dojocoding.hermit.notifications

import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File

class HermitNotificationsModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext) { "No React context" }

  override fun definition() = ModuleDefinition {
    Name("HermitNotifications")
    Events("onCapture")

    OnStartObserving("onCapture") {
      HermitNotificationListener.sink = { b -> sendEvent("onCapture", b) }
    }
    OnStopObserving("onCapture") {
      HermitNotificationListener.sink = null
    }

    /** US-ONB-04: whether the user granted notification access to Hermit. */
    Function("isEnabled") {
      NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    }

    Function("openSettings") {
      context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** FR-MSG-02: messages captured while JavaScript was not running, oldest first; the queue is emptied. */
    AsyncFunction("drainQueue") {
      synchronized(HermitNotificationListener::class.java) {
        val f = File(context.filesDir, HermitNotificationListener.QUEUE_FILE)
        if (!f.exists()) return@AsyncFunction emptyList<Map<String, Any?>>()
        val rows = f.readLines().filter { it.isNotBlank() }.map { line ->
          val o = JSONObject(line)
          o.keys().asSequence().associateWith { k -> o.get(k) }
        }
        f.delete()
        rows
      }
    }

    /**
     * FR-MODEL-02: SHA-256 of a local file, streamed natively. Hashing the 529 MB model in JS blocks the
     * JS thread for minutes; MessageDigest does it in seconds. Accepts a file:// URI or a path.
     */
    AsyncFunction("sha256File") { uri: String ->
      val path = if (uri.startsWith("file://")) android.net.Uri.parse(uri).path!! else uri
      val digest = java.security.MessageDigest.getInstance("SHA-256")
      java.io.FileInputStream(path).use { input ->
        val buf = ByteArray(1 shl 20)
        while (true) {
          val n = input.read(buf)
          if (n < 0) break
          digest.update(buf, 0, n)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Device-adaptive runtime (docs/research/device-adaptive-runtime.md): the CPU layout and features the
     * runtime plan is built from. Clusters come from sysfs max frequencies (fastest first), features from
     * /proc/cpuinfo, the cores this process may run on from /proc/self/status (CpuAffinity: logicalCores counts
     * every online core, Android's cpuset gives the app fewer). Read-only, no permissions, nothing leaves the phone.
     */
    AsyncFunction("hardwareFacts") {
      val byFreq = sortedMapOf<Long, MutableList<Int>>(compareByDescending { it })
      val cpuDir = File("/sys/devices/system/cpu")
      cpuDir.listFiles { f -> f.name.matches(Regex("cpu\\d+")) }?.forEach { f ->
        val idx = f.name.removePrefix("cpu").toInt()
        val freq = runCatching { File(f, "cpufreq/cpuinfo_max_freq").readText().trim().toLong() }.getOrNull() ?: return@forEach
        byFreq.getOrPut(freq) { mutableListOf() }.add(idx)
      }
      val features = runCatching {
        File("/proc/cpuinfo").readLines().firstOrNull { it.startsWith("Features") }?.substringAfter(":")?.trim()?.split(" ")?.toSet()
      }.getOrNull() ?: emptySet()
      val am = context.getSystemService(android.content.Context.ACTIVITY_SERVICE) as android.app.ActivityManager
      val mem = android.app.ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
      mapOf(
        "clusters" to byFreq.map { (freq, cpus) -> mapOf("cpus" to cpus.sorted(), "maxFreqKHz" to freq) },
        "logicalCores" to Runtime.getRuntime().availableProcessors(),
        // Empty when unreadable: the plan then keeps its stopgap thread count.
        "allowedCpus" to (CpuAffinity.allowed() ?: emptyList()),
        "totalRamBytes" to mem.totalMem.toDouble(),
        "isLowRamDevice" to am.isLowRamDevice,
        "soc" to (if (android.os.Build.VERSION.SDK_INT >= 31) android.os.Build.SOC_MODEL else android.os.Build.HARDWARE),
        "model" to android.os.Build.MODEL,
        "dotprod" to features.contains("asimddp"),
        "i8mm" to features.contains("i8mm"),
        "sve2" to features.contains("sve2"),
        "sme2" to features.contains("sme2"),
      )
    }

    /**
     * The cores this process may run on right now and the cpuset it is in, both read again at every call (two small
     * /proc files): the engine calls it right before the model loads and at each safe point, so the model's threads
     * follow the app between foreground and background. Empty and "" when unreadable.
     */
    Function("allowedCpus") {
      mapOf("cpus" to (CpuAffinity.allowed() ?: emptyList()), "cpuset" to (CpuAffinity.cpuset() ?: ""))
    }

    /**
     * The Device lab: the chip's names as Android reports them (Build.SOC_MANUFACTURER and Build.SOC_MODEL on Android
     * 12 and later), the Hardware line of /proc/cpuinfo (older kernels have one) and Build.HARDWARE. Read-only, no
     * permission, nothing leaves the phone. An empty string for what isn't there.
     */
    Function("chipFacts") {
      val cpuinfoHardware = runCatching {
        File("/proc/cpuinfo").useLines { lines -> lines.firstOrNull { it.startsWith("Hardware") }?.substringAfter(":")?.trim() }
      }.getOrNull() ?: ""
      mapOf(
        "socManufacturer" to (if (android.os.Build.VERSION.SDK_INT >= 31) android.os.Build.SOC_MANUFACTURER else ""),
        "socModel" to (if (android.os.Build.VERSION.SDK_INT >= 31) android.os.Build.SOC_MODEL else ""),
        "cpuinfoHardware" to cpuinfoHardware,
        "hardware" to android.os.Build.HARDWARE,
      )
    }

    /** The Device lab keeps the screen on while it runs: a window flag, no permission. False without an activity. */
    AsyncFunction("keepScreenOn") { on: Boolean ->
      val window = appContext.currentActivity?.window ?: return@AsyncFunction false
      if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      true
    }.runOnQueue(Queues.MAIN)

    /** Thermal state and headroom (1.0 = throttling now; NaN when unsupported), for per-request budgets. */
    Function("thermal") {
      val pm = context.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
      val status = if (android.os.Build.VERSION.SDK_INT >= 29) pm.currentThermalStatus else 0
      val headroom = if (android.os.Build.VERSION.SDK_INT >= 30) pm.getThermalHeadroom(10).toDouble() else Double.NaN
      mapOf("status" to status, "headroom" to headroom, "powerSave" to pm.isPowerSaveMode)
    }

    /**
     * SL-24, FR-NIGHT-01: the night shift's guards. Charging and battery level from BatteryManager (no
     * permission), the screen from PowerManager.isInteractive. An unsupported level comes back negative.
     */
    Function("power") {
      val bm = context.getSystemService(android.content.Context.BATTERY_SERVICE) as android.os.BatteryManager
      val pm = context.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
      mapOf(
        "charging" to bm.isCharging,
        "batteryPercent" to bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY),
        "screenOn" to pm.isInteractive,
      )
    }

    /** FR-MSG-04: fires the stored reply action; "stale" when the notification is gone. */
    AsyncFunction("reply") { handle: String, text: String ->
      val action = HermitNotificationListener.replyActions[handle] ?: return@AsyncFunction "stale"
      val inputs = action.remoteInputs ?: return@AsyncFunction "stale"
      val results = Bundle()
      for (input in inputs) if (input.allowFreeFormInput) results.putCharSequence(input.resultKey, text)
      val intent = Intent()
      RemoteInput.addResultsToIntent(inputs, intent, results)
      try {
        action.actionIntent.send(context, 0, intent)
        "sent"
      } catch (e: PendingIntent.CanceledException) {
        HermitNotificationListener.replyActions.remove(handle)
        "stale"
      }
    }
  }
}
