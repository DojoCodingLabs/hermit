package io.dojocoding.hermit.browser

import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.WebStorage
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest

/**
 * SL-53 (US-WEB-06 to US-WEB-08, FR-WEB-05): Hermit's in-app browser. One WebView per task, with its own profile per
 * site where the phone's WebView supports profiles (cookies, storage and cache kept apart from every other site and
 * from Hermit), https only, no file or content access, no pop-ups, no permissions, third-party cookies off. Main-frame
 * navigation is refused outside the task's exact origin. Every request's address is reported to JS so the privacy
 * screen counts its host (FR-PRIV-02). JS drives the page through `evaluate` with Hermit's own script; the page's words
 * come back as data.
 */
class HermitBrowserModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext) { "No React context" }

  override fun definition() = ModuleDefinition {
    Name("HermitBrowser")

    /**
     * { multiProfile, recorder, identity }: whether sites get their own profiles, whether the WebView has the web message
     * channel recording needs, and Hermit's own `android://<cert>@<package>`.
     */
    Function("status") {
      mapOf(
        "multiProfile" to WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE),
        "recorder" to HermitBrowserView.recorderSupported(),
        "identity" to identity(),
      )
    }

    /**
     * Clears a site's cookies, storage and cache (US-WEB-06). With profiles, only that site's profile; without them, the
     * one shared WebView store (nothing else of Hermit's lives there).
     */
    AsyncFunction("clearSite") { profile: String, promise: Promise ->
      try {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) && HermitBrowserView.isProfileName(profile)) {
          val p = ProfileStore.getInstance().getOrCreateProfile(profile)
          p.cookieManager.removeAllCookies { promise.resolve(true) }
          p.webStorage.deleteAllData()
        } else {
          CookieManager.getInstance().removeAllCookies { promise.resolve(true) }
          WebStorage.getInstance().deleteAllData()
        }
      } catch (e: Exception) {
        promise.resolve(false)
      }
    }.runOnQueue(Queues.MAIN)

    View(HermitBrowserView::class) {
      Events("onBrowserEvent")

      /** The site's profile name (`site_<hash of the origin>`), set once before the first load. */
      Prop("profile") { view: HermitBrowserView, name: String? -> view.setProfileName(name) }

      /** The exact origin every main-frame navigation must stay on; null refuses every navigation but `load`. */
      Prop("allowedOrigin") { view: HermitBrowserView, origin: String? -> view.allowedOrigin = origin }

      /** While true, the recorder's checked events reach JS (US-WEB-11); otherwise they are dropped. */
      Prop("recording") { view: HermitBrowserView, on: Boolean -> view.recording = on }

      /** Starts the recorder on the current page with a fresh native token; true when it is listening. */
      AsyncFunction("injectRecorder") { view: HermitBrowserView, script: String, promise: Promise -> view.injectRecorder(script, promise) }.runOnQueue(Queues.MAIN)

      AsyncFunction("load") { view: HermitBrowserView, url: String -> view.load(url) }.runOnQueue(Queues.MAIN)

      AsyncFunction("evaluate") { view: HermitBrowserView, script: String, promise: Promise -> view.evaluate(script, promise) }.runOnQueue(Queues.MAIN)

      /** The main frame's address as the WebView reports it (never as the page says). */
      AsyncFunction("currentUrl") { view: HermitBrowserView -> view.currentUrl() }.runOnQueue(Queues.MAIN)

      AsyncFunction("clearCache") { view: HermitBrowserView -> view.clearCache() }.runOnQueue(Queues.MAIN)
    }
  }

  /** Hermit's own verified identity, the same form the autofill service gives apps: SHA-256 of the signing key, base64url. */
  private fun identity(): String {
    val pkg = context.packageName
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return "android://unknown@$pkg"
    return try {
      val info = context.packageManager.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES)
      val signer = info.signingInfo?.apkContentsSigners?.firstOrNull() ?: return "android://unknown@$pkg"
      val digest = MessageDigest.getInstance("SHA-256").digest(signer.toByteArray())
      "android://${Base64.encodeToString(digest, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)}@$pkg"
    } catch (e: Exception) {
      "android://unknown@$pkg"
    }
  }
}
