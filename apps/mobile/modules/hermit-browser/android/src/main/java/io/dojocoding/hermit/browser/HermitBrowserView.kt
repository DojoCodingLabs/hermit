package io.dojocoding.hermit.browser

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * SL-53: the WebView a task drives. The events JS gets: `started` and `load` (the main frame's address), `request`
 * (every request's address, for the host counter), `blocked` (a navigation refused: not https, or off the task's
 * origin), and `record` (one recorder event while recording, at most 4 KB).
 *
 * The recorder talks back over a web message channel (`WebViewCompat.addWebMessageListener`), never a
 * `JavascriptInterface`: the channel object is injected only into frames on the task's exact origin, and a message
 * counts only when it comes from the main frame, from that origin, while recording is on, and starts with the random
 * token this view generated for the current injection (`injectRecorder`). An iframe, an ad, or a page the user
 * navigated to can't post fake steps.
 */
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class HermitBrowserView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onBrowserEvent by EventDispatcher()
  private val webView = WebView(context)
  private var profileSet = false

  /** The exact origin every main-frame navigation must stay on, and the only origin the recorder channel exists on. */
  var allowedOrigin: String? = null
    set(value) {
      field = value
      updateRecorderListener()
    }

  /** While true, recorder messages that pass every check reach JS. Turning it off forgets the token. */
  var recording = false
    set(value) {
      field = value
      if (!value) stopRecorderScript()
    }

  /**
   * The token of the current recording; null until `injectRecorder`. The document-start script carries it into every
   * new page of the task's origin, so it lives as long as the registered script. Main thread only.
   */
  private var recorderToken: String? = null

  /** The origin the recorder channel is registered for, or null when it isn't. */
  private var listenerOrigin: String? = null

  companion object {
    private val PROFILE = Regex("^site_[0-9a-f]{16,64}$")
    private const val RECORDER_OBJECT = "HermitRecorder"
    private const val TOKEN_PLACEHOLDER = "__HERMIT_RECORDER_TOKEN__"
    private const val MAX_EVENT = 4096
    private val random = SecureRandom()

    fun isProfileName(name: String) = PROFILE.matches(name)

    /** Whether this phone's WebView has the web message channel the recorder needs. */
    fun recorderSupported() = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)

    /** The exact origin of an address (scheme, host, non-default port), lowercase; null for anything but https. */
    fun originOf(uri: Uri): String? {
      if (uri.scheme != "https") return null
      val host = uri.host?.lowercase() ?: return null
      if (uri.userInfo != null) return null
      val port = uri.port
      return if (port == -1 || port == 443) "https://$host" else "https://$host:$port"
    }

    private fun newToken(): String {
      val bytes = ByteArray(16)
      random.nextBytes(bytes)
      return bytes.joinToString("") { "%02x".format(it) }
    }
  }

  private val recorderListener = WebViewCompat.WebMessageListener { _, message, sourceOrigin, isMainFrame, _ ->
    val json = recorderPayload(message.data, sourceOrigin, isMainFrame) ?: return@WebMessageListener
    onBrowserEvent(mapOf("type" to "record", "url" to (webView.url ?: ""), "event" to json))
  }

  init {
    addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    webView.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      allowFileAccess = false
      allowContentAccess = false
      setGeolocationEnabled(false)
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      setSupportMultipleWindows(false)
      javaScriptCanOpenWindowsAutomatically = false
      safeBrowsingEnabled = true
      mediaPlaybackRequiresUserGesture = true
    }
    CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
    webView.webChromeClient = object : WebChromeClient() {
      override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
        callback?.invoke(origin, false, false)
      }
      override fun onPermissionRequest(request: PermissionRequest?) {
        request?.deny()
      }
    }
    webView.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val req = request ?: return true
        if (!req.isForMainFrame) return false
        val origin = originOf(req.url)
        if (origin == null || origin != allowedOrigin) {
          emit("blocked", req.url.toString())
          return true
        }
        return false
      }
      override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        // A new document gets the recorder from the document-start script, with the same token, before its own scripts.
        emit("started", url ?: "")
      }
      override fun onPageFinished(view: WebView?, url: String?) {
        emit("load", url ?: "")
      }
      override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
        val url = request?.url?.toString() ?: return null
        post { emit("request", url) }
        return null
      }
      @SuppressLint("WebViewClientOnReceivedSslError")
      override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
        handler?.cancel()
      }
    }
  }

  private fun emit(type: String, url: String) {
    onBrowserEvent(mapOf("type" to type, "url" to url))
  }

  /** The channel exists only for the task's exact origin; a new origin replaces it, none removes it. */
  private fun updateRecorderListener() {
    if (!recorderSupported()) return
    val origin = allowedOrigin?.takeIf { originOf(Uri.parse(it)) == it }
    if (origin == listenerOrigin) return
    if (listenerOrigin != null) {
      WebViewCompat.removeWebMessageListener(webView, RECORDER_OBJECT)
      listenerOrigin = null
    }
    stopRecorderScript()
    if (origin == null) return
    try {
      WebViewCompat.addWebMessageListener(webView, RECORDER_OBJECT, setOf(origin), recorderListener)
      listenerOrigin = origin
    } catch (e: IllegalArgumentException) {
      listenerOrigin = null
    }
  }

  /** One recorder message's JSON, or null unless every check passes. Runs on the main thread. */
  private fun recorderPayload(data: String?, sourceOrigin: Uri, isMainFrame: Boolean): String? {
    if (!recording || !isMainFrame || data == null) return null
    val expected = allowedOrigin ?: return null
    if (listenerOrigin != expected || originOf(sourceOrigin) != expected) return null
    val pageOrigin = webView.url?.let { originOf(Uri.parse(it)) }
    if (pageOrigin != expected) return null
    val token = recorderToken ?: return null
    val sep = data.indexOf(':')
    if (sep <= 0) return null
    if (!MessageDigest.isEqual(data.substring(0, sep).toByteArray(Charsets.UTF_8), token.toByteArray(Charsets.UTF_8))) return null
    val json = data.substring(sep + 1)
    return if (json.length > MAX_EVENT) null else json
  }

  /** The document-start recorder script registered for this recording, and the origin it is registered for. */
  private var recorderScript: ScriptHandler? = null
  private var recorderScriptOrigin: String? = null

  /**
   * Starts the recorder (security review): a fresh token goes into the script, which is registered with
   * `addDocumentStartJavaScript` for the task's exact origin, so it runs in the main frame before any page script and
   * captures the channel and the primitives it uses before the page can touch them. The page is reloaded once so the
   * recorder is in place from the start; later loads of the same origin get it automatically. Without document-start
   * support recording is refused rather than run where the page could read the token. JS never holds the token.
   */
  fun injectRecorder(script: String, promise: Promise) {
    val expected = allowedOrigin
    val pageOrigin = webView.url?.let { originOf(Uri.parse(it)) }
    if (!recording || expected == null || listenerOrigin != expected || pageOrigin != expected || !script.contains(TOKEN_PLACEHOLDER) ||
      !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      promise.resolve(false)
      return
    }
    if (recorderScript != null && recorderScriptOrigin == expected && recorderToken != null) {
      promise.resolve(true)
      return
    }
    stopRecorderScript()
    val token = newToken()
    try {
      recorderScript = WebViewCompat.addDocumentStartJavaScript(webView, script.replace(TOKEN_PLACEHOLDER, token), setOf(expected))
      recorderScriptOrigin = expected
      recorderToken = token
    } catch (e: IllegalArgumentException) {
      stopRecorderScript()
      promise.resolve(false)
      return
    }
    webView.reload()
    promise.resolve(true)
  }

  /** Removes the document-start recorder and forgets its token. */
  fun stopRecorderScript() {
    recorderScript?.remove()
    recorderScript = null
    recorderScriptOrigin = null
    recorderToken = null
  }

  /** A site's own profile, once, before anything loads; without profile support the shared store is cleared after each task. */
  fun setProfileName(name: String?) {
    if (profileSet || name == null || !isProfileName(name)) return
    if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
      WebViewCompat.setProfile(webView, name)
      profileSet = true
    }
  }

  fun load(url: String): Boolean {
    val uri = Uri.parse(url)
    val origin = originOf(uri)
    if (origin == null || origin != allowedOrigin) {
      emit("blocked", url)
      return false
    }
    webView.loadUrl(url)
    return true
  }

  fun evaluate(script: String, promise: Promise) {
    webView.evaluateJavascript(script) { result -> promise.resolve(result ?: "null") }
  }

  fun currentUrl(): String = webView.url ?: ""

  fun clearCache() {
    webView.clearCache(true)
    webView.clearHistory()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    recording = false
    stopRecorderScript()
  }
}
