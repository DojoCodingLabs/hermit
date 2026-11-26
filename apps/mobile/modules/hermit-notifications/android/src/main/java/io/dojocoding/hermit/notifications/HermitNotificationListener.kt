package io.dojocoding.hermit.notifications

import android.app.Notification
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * FR-MSG-01, FR-MSG-02: captures messages from allow-listed messengers. When JavaScript is listening,
 * each message goes straight to it; otherwise it is appended to a private queue file that the app drains
 * on start. Reply actions are kept in memory only: after a restart or a dismissal, a reply is "stale".
 */
class HermitNotificationListener : NotificationListenerService() {
  companion object {
    val ALLOWED = setOf("com.whatsapp", "com.whatsapp.w4b")
    const val QUEUE_FILE = "hermit-capture-queue.jsonl"
    /** reply handle (the notification key) -> the live reply action */
    val replyActions = ConcurrentHashMap<String, Notification.Action>()
    @Volatile var sink: ((Bundle) -> Unit)? = null
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (sbn.packageName !in ALLOWED) return
    val n = sbn.notification ?: return
    if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return

    val extras = n.extras
    val title = (extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)
      ?: extras.getCharSequence(Notification.EXTRA_TITLE))?.toString() ?: return
    val conversationKey = n.shortcutId ?: sbn.tag ?: title

    val reply = n.actions?.firstOrNull { a -> a.remoteInputs?.any { it.allowFreeFormInput } == true }
    val handle = reply?.let { replyActions[sbn.key] = it; sbn.key }

    val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)
    val messages = style?.messages.orEmpty()
    if (messages.isEmpty()) {
      val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: return
      emit(sbn, conversationKey, title, title, text, sbn.postTime, handle)
    } else {
      val self = style?.user
      for (m in messages) {
        val text = m.text?.toString() ?: continue
        // In MessagingStyle a null person is the phone's owner. Never attribute the user's own
        // messages to the contact: skip them (Hermit reports what others wrote).
        val person = m.person ?: continue
        if (self != null && ((self.key != null && self.key == person.key) || (self.key == null && self.name == person.name))) continue
        val sender = person.name?.toString() ?: continue
        emit(sbn, conversationKey, title, sender, text, m.timestamp, handle)
      }
    }
  }

  override fun onNotificationRemoved(sbn: StatusBarNotification) {
    // A dismissed or replaced notification can no longer carry a reply (FR-MSG-04).
    replyActions.remove(sbn.key)
  }

  private fun emit(sbn: StatusBarNotification, key: String, title: String, sender: String, text: String, at: Long, handle: String?) {
    val b = Bundle().apply {
      putString("packageName", sbn.packageName)
      putString("conversationKey", key)
      putString("title", title)
      putString("sender", sender)
      putString("text", text)
      putDouble("postedAt", at.toDouble())
      // Per-message identity: the notification key plus a hash of sender and text, so two different
      // messages with the same timestamp aren't dropped as duplicates, and re-posts still are.
      putString("notificationKey", "${sbn.key}#${(sender + "\u0000" + text).hashCode()}")
      if (handle != null) putString("replyHandle", handle)
    }
    val live = sink
    if (live != null) live(b) else enqueue(b)
  }

  private fun enqueue(b: Bundle) {
    val json = JSONObject()
    for (k in b.keySet()) json.put(k, b.get(k))
    synchronized(HermitNotificationListener::class.java) {
      File(filesDir, QUEUE_FILE).appendText(json.toString() + "\n")
    }
  }
}
