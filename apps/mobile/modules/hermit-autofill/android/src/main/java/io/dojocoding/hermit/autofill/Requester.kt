package io.dojocoding.hermit.autofill

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import java.security.MessageDigest

/** Who asks to be filled, as PackageManager knows it (SL-20). */
object Requester {
  /**
   * SHA-256 of each certificate that signed the package's current APK, base64url without padding (the Digital Asset
   * Links digest). Empty when the package can't be read (not installed, or not visible to Hermit): the rule refuses.
   */
  fun certDigests(context: Context, packageName: String): List<String> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return emptyList()
    return try {
      val info = context.packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
      val signers = info.signingInfo?.apkContentsSigners ?: return emptyList()
      signers.map {
        val digest = MessageDigest.getInstance("SHA-256").digest(it.toByteArray())
        Base64.encodeToString(digest, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  /** What the app calls itself. Shown on the sheet next to its package and key, never trusted as its identity. */
  fun label(context: Context, packageName: String): String? =
    try {
      val info: ApplicationInfo = context.packageManager.getApplicationInfo(packageName, 0)
      context.packageManager.getApplicationLabel(info).toString().take(80)
    } catch (e: Exception) {
      null
    }
}
