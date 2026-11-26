package io.dojocoding.hermit.autofill

import java.lang.ref.WeakReference
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * SL-35: fills waiting for Hermit's approval sheet (HM-FORM-01). The auth activity adds one and opens Hermit; the
 * sheet reads the request (who asks and which fields, never a value), and the module hands back the approved values
 * or the user's no. In memory only: a request dies with the process or when its activity ends.
 */
object PendingFills {
  private class Entry(val activity: WeakReference<AutofillAuthActivity>, val json: String)

  private val entries = ConcurrentHashMap<String, Entry>()

  fun add(activity: AutofillAuthActivity, json: (id: String) -> String): String {
    val id = UUID.randomUUID().toString()
    entries[id] = Entry(WeakReference(activity), json(id))
    return id
  }

  /** The request as JSON for the sheet, or null when it ended. */
  fun request(id: String): String? = entries[id]?.json

  /** Hands the approved values to the waiting activity. False when the request already ended. */
  fun complete(id: String, values: Map<String, String>): Boolean {
    val activity = entries.remove(id)?.activity?.get() ?: return false
    if (activity.isFinishing || activity.isDestroyed) return false
    activity.runOnUiThread { activity.deliver(values) }
    return true
  }

  fun cancel(id: String): Boolean {
    val activity = entries.remove(id)?.activity?.get() ?: return false
    activity.runOnUiThread { activity.declined() }
    return true
  }

  fun remove(id: String) {
    entries.remove(id)
  }
}
