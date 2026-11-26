package io.dojocoding.hermit.vault

import android.app.Activity
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.view.WindowManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore

/**
 * SL-33: the vault's native pieces that expo-secure-store and React Native don't cover.
 *
 * - destroyKeystoreKey: SecureStore's deleteItemAsync removes the wrapped value but leaves the Android Keystore key that
 *   wrapped it. Delete everything and a vault reset destroy that key too. The aliases are expo-secure-store 58's
 *   (`AESEncryptor.getExtendedKeyStoreAlias`): "AES/GCM/NoPadding:<keychainService>:keystore(Un)authenticated".
 * - setSecureScreen: FLAG_SECURE while a vault screen shows, so it can't be screenshotted, recorded or seen in Recents.
 * - copySensitive: the clip is marked sensitive (Android 13 and later hide it from the copy preview and keyboards'
 *   suggestions), and a native timer clears it after `clearAfterMs` unless something else was copied since (Q82).
 *   The timer lives with the process: if Android kills Hermit first, Android's own clipboard expiry is the backstop.
 * - pickCsv, readDocument, deleteDocument (SL-34): the import's file, through the system picker (CsvDocument).
 */
class HermitVaultModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext) { "No React context" }
  private val clipboard get() = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
  private val main = Handler(Looper.getMainLooper())
  private var pendingClear: Runnable? = null
  /** True once another clip replaced ours while Hermit could see it; the timer then leaves the clipboard alone. */
  private var replaced = false
  private var settingOurs = false
  private val onChange = ClipboardManager.OnPrimaryClipChangedListener { if (!settingOurs) replaced = true }
  /** The JavaScript call waiting for the document picker to return. */
  private var picking: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("HermitVault")

    OnCreate { main.post { clipboard.addPrimaryClipChangedListener(onChange) } }

    OnDestroy {
      main.post { clipboard.removePrimaryClipChangedListener(onChange) }
    }

    /** SL-34: the system document picker for one CSV. Resolves null when the user backs out. */
    AsyncFunction("pickCsv") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      if (picking != null) {
        promise.reject(CodedException("ERR_BUSY", "The file picker is already open.", null))
        return@AsyncFunction
      }
      picking = promise
      try {
        activity.startActivityForResult(CsvDocument.pickIntent(), CsvDocument.REQUEST_CODE)
      } catch (e: Exception) {
        picking = null
        promise.reject(CodedException("ERR_NO_PICKER", "No document picker on this phone.", null))
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != CsvDocument.REQUEST_CODE) return@OnActivityResult
      val promise = picking ?: return@OnActivityResult
      picking = null
      val uri = payload.data?.data
      if (payload.resultCode != Activity.RESULT_OK || uri == null) {
        promise.resolve(null)
        return@OnActivityResult
      }
      try {
        promise.resolve(CsvDocument.describe(context, uri))
      } catch (e: Exception) {
        promise.reject(CodedException("ERR_UNREADABLE", "The file can't be read.", null))
      }
    }

    /** The picked file's bytes, at most `maxBytes` (ERR_TOO_LARGE past it), read into memory only. */
    AsyncFunction("readDocument") { uri: String, maxBytes: Int ->
      CsvDocument.read(context.contentResolver, Uri.parse(uri), maxBytes)
    }

    /** Deletes the picked file through the picker's grant; false when its provider can't. */
    AsyncFunction("deleteDocument") { uri: String ->
      CsvDocument.delete(context.contentResolver, Uri.parse(uri))
    }

    /**
     * Whether a wrapped value and its Keystore key both exist, without a prompt: a SecureStore read of an
     * authentication-bound entry always prompts. expo-secure-store 58 keeps entries in the "SecureStore" preferences
     * as "<keychainService>-<key>". An invalidated Keystore key still shows here; the next unwrap then reports it lost.
     */
    AsyncFunction("hasWrappedKey") { service: String, key: String ->
      val prefs = context.getSharedPreferences("SecureStore", Context.MODE_PRIVATE)
      val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      prefs.contains("$service-$key") && ks.containsAlias("AES/GCM/NoPadding:$service:keystoreAuthenticated")
    }

    /**
     * Delete everything: private preferences files other native modules keep (NATIVE_PREFERENCES in @hermit/core),
     * emptied first so nothing survives if the file delete fails. Idempotent: a file already gone is fine.
     */
    AsyncFunction("deletePreferences") { names: List<String> ->
      for (name in names) {
        context.getSharedPreferences(name, Context.MODE_PRIVATE).edit().clear().commit()
        context.deleteSharedPreferences(name)
      }
    }

    /** Idempotent: an alias already gone is fine. */
    AsyncFunction("destroyKeystoreKey") { service: String ->
      val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      for (suffix in listOf("keystoreAuthenticated", "keystoreUnauthenticated")) {
        val alias = "AES/GCM/NoPadding:$service:$suffix"
        if (ks.containsAlias(alias)) ks.deleteEntry(alias)
      }
    }

    AsyncFunction("setSecureScreen") { on: Boolean ->
      val window = appContext.currentActivity?.window ?: return@AsyncFunction false
      if (on) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("copySensitive") { text: String, clearAfterMs: Double ->
      val clip = ClipData.newPlainText("Hermit", text)
      clip.description.extras = PersistableBundle().apply {
        // ClipDescription.EXTRA_IS_SENSITIVE on 33+; the same key is honored by some keyboards before that.
        putBoolean(if (Build.VERSION.SDK_INT >= 33) ClipDescription.EXTRA_IS_SENSITIVE else "android.content.extra.IS_SENSITIVE", true)
      }
      settingOurs = true
      try {
        clipboard.setPrimaryClip(clip)
      } finally {
        settingOurs = false
      }
      replaced = false
      pendingClear?.let { main.removeCallbacks(it) }
      val clear = Runnable {
        pendingClear = null
        if (!replaced) clearClip()
      }
      pendingClear = clear
      main.postDelayed(clear, clearAfterMs.toLong().coerceAtLeast(1_000L))
    }.runOnQueue(Queues.MAIN)

    /**
     * SL-39 (HM-PAY-04): a wallet address is public, so it is copied as a plain clip, explicitly not sensitive, with no
     * clear timer. It isn't marked as ours, so a pending sensitive copy's timer sees it as a replacement and leaves it.
     */
    AsyncFunction("copyPlain") { text: String ->
      val clip = ClipData.newPlainText("Hermit", text)
      clip.description.extras = PersistableBundle().apply {
        putBoolean(if (Build.VERSION.SDK_INT >= 33) ClipDescription.EXTRA_IS_SENSITIVE else "android.content.extra.IS_SENSITIVE", false)
      }
      clipboard.setPrimaryClip(clip)
      replaced = true
    }.runOnQueue(Queues.MAIN)

    /** Locking or leaving the vault clears a pending copy right away (unless something else was copied since). */
    AsyncFunction("clearPendingCopy") {
      val pending = pendingClear
      if (pending != null) {
        main.removeCallbacks(pending)
        pendingClear = null
        if (!replaced) clearClip()
      }
      null
    }.runOnQueue(Queues.MAIN)
  }

  private fun clearClip() {
    settingOurs = true
    try {
      if (Build.VERSION.SDK_INT >= 28) clipboard.clearPrimaryClip() else clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
    } finally {
      settingOurs = false
    }
  }
}
