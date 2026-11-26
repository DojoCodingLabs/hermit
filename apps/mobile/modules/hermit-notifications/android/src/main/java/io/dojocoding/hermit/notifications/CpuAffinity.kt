package io.dojocoding.hermit.notifications

import java.io.File

/**
 * Device-adaptive runtime: the cores this process may run on now. Android moves an app between cpusets as it comes and
 * goes (the Galaxy S26 Ultra on 2026-11-24: "foreground" 0-5 and "top-app" 0-7 on screen, "background" 0-1,4-5), every
 * thread inherits the set, the model's included, and availableProcessors() still counts every online core. The kernel
 * keeps the set with the affinity mask applied in Cpus_allowed_list (/proc/self/status). Read-only files of this
 * process, no permission, nothing leaves the phone.
 */
internal object CpuAffinity {
  private const val MAX_CPUS = 1024

  /** "0-5", "0-1,4-5" or "3" as sorted, distinct CPU indices; null when the text is not such a list. */
  fun parseList(text: String): List<Int>? {
    val body = text.trim()
    if (body.isEmpty()) return null
    val cpus = sortedSetOf<Int>()
    for (raw in body.split(',')) {
      val part = raw.trim()
      val dash = part.indexOf('-')
      val from = (if (dash < 0) part else part.substring(0, dash)).trim().toIntOrNull() ?: return null
      val to = if (dash < 0) from else part.substring(dash + 1).trim().toIntOrNull() ?: return null
      if (from < 0 || to < from || to >= MAX_CPUS) return null
      for (cpu in from..to) cpus.add(cpu)
    }
    return cpus.toList()
  }

  /** The Cpus_allowed_list line of a /proc/<pid>/status text; null without one. */
  fun fromStatus(status: String): List<Int>? =
    status.lineSequence().firstOrNull { it.startsWith("Cpus_allowed_list:") }?.substringAfter(':')?.let { parseList(it) }

  /** The cpuset's path ("/foreground", "/top-app", "/background"), for the logs only; null when it isn't one. */
  fun cpusetName(text: String): String? = text.lineSequence().first().trim().takeIf { it.startsWith("/") && it.length <= 64 }

  /** The cores this process may run on now; null when unreadable. */
  fun allowed(): List<Int>? = runCatching { fromStatus(File("/proc/self/status").readText()) }.getOrNull()

  /** The cpuset this process is in now; null when unreadable. */
  fun cpuset(): String? = runCatching { cpusetName(File("/proc/self/cpuset").readText()) }.getOrNull()
}
