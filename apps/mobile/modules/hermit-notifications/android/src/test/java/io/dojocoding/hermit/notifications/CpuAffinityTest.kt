package io.dojocoding.hermit.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The cores this process may run on, from the kernel's own list (Cpus_allowed_list in /proc/self/status). The sets
 * are the ones the Galaxy S26 Ultra showed on 2026-11-24: "foreground" 0-5, "top-app" 0-7, "background" 0-1,4-5.
 */
class CpuAffinityTest {
  private fun status(list: String) =
    "Name:\tio.dojocoding.hermit\nState:\tS (sleeping)\nTgid:\t12345\nThreads:\t87\n" +
      "Cpus_allowed:\t3f\nCpus_allowed_list:\t$list\nMems_allowed:\t1\nMems_allowed_list:\t0\nvoluntary_ctxt_switches:\t1520\n"

  @Test fun readsTheS26CpusetsFromStatus() {
    assertEquals(listOf(0, 1, 2, 3, 4, 5), CpuAffinity.fromStatus(status("0-5")))
    assertEquals(listOf(0, 1, 2, 3, 4, 5, 6, 7), CpuAffinity.fromStatus(status("0-7")))
    assertEquals(listOf(0, 1, 4, 5), CpuAffinity.fromStatus(status("0-1,4-5")))
  }

  @Test fun parsesRangesAndSingleCoresInAnyMix() {
    assertEquals(listOf(3), CpuAffinity.parseList("3"))
    assertEquals(listOf(0, 2, 3, 4, 7), CpuAffinity.parseList("0,2-4,7"))
    // Whitespace around the list and its parts, and parts out of order or repeated, still give one sorted set.
    assertEquals(listOf(0, 1, 2, 3), CpuAffinity.parseList(" 2-3, 0-1 ,1\n"))
  }

  @Test fun anythingElseIsUnknownNeverAGuess() {
    for (bad in listOf("", " ", "x", "5-0", "-1", "0-", "-", "1,,2", "0-3,a", "0x3f", "0-99999", "2147483647")) {
      assertNull("\"$bad\"", CpuAffinity.parseList(bad))
    }
    // A status without the line (a kernel that doesn't report it) is unknown too.
    assertNull(CpuAffinity.fromStatus("Name:\tio.dojocoding.hermit\nCpus_allowed:\t3f\n"))
    assertNull(CpuAffinity.fromStatus(""))
  }

  @Test fun theCpusetNameIsItsPathOrNothing() {
    assertEquals("/foreground", CpuAffinity.cpusetName("/foreground\n"))
    assertEquals("/top-app", CpuAffinity.cpusetName("/top-app"))
    assertEquals("/", CpuAffinity.cpusetName("/\n"))
    assertNull(CpuAffinity.cpusetName(""))
    assertNull(CpuAffinity.cpusetName("foreground"))
    // Nothing but the first line, and never a long text, reaches the logs.
    assertEquals("/background", CpuAffinity.cpusetName("/background\nmore"))
    assertNull(CpuAffinity.cpusetName("/" + "a".repeat(200)))
  }
}
