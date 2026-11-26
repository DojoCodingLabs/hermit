package io.dojocoding.hermit.approvalkey

import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * SL-37 (US-CAGE-03, FR-CAGE-06, ADR-007): the key that signs money and password approvals.
 *
 * - EC P-256 in the Android Keystore, in StrongBox when the phone has one, else the TEE; a software key is refused.
 * - Never exportable (Keystore private keys never leave the hardware); only the public part is read.
 * - User authentication required for every use: timeout 0 with BIOMETRIC_STRONG only (API 30 and later), or the
 *   per-use form (-1) before that. No device-credential fallback, so a PIN never approves a payment.
 * - Invalidated when a fingerprint is added or removed: Android then throws KeyPermanentlyInvalidatedException at
 *   initSign, `state` reports "lost", and money and passwords are blocked until the user sets the key up again.
 * - `sign` initializes the Signature and hands it to BiometricPrompt as a CryptoObject: the fingerprint unlocks exactly
 *   that one signature over exactly the message given. Every word of the prompt is chosen here (ApprovalText): its own
 *   strings by locale code and the facts read from that message; JavaScript passes no display text.
 */
class HermitApprovalKeyModule : Module() {
  companion object {
    const val ALIAS = "hermit.approval-key.v1"
  }

  private class NewKey(val level: String, val publicKey: String, val signature: Signature)

  private val context get() = requireNotNull(appContext.reactContext) { "No React context" }
  private var prompting = false

  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

  private fun strongBiometric(): Boolean =
    BiometricManager.from(context).canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

  /** "strongbox", "tee", or null for a key that is software-only or doesn't carry the attributes we set. */
  private fun levelOf(key: PrivateKey): String? {
    val info = KeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java)
    if (!info.isUserAuthenticationRequired || info.userAuthenticationValidityDurationSeconds > 0) return null
    if (Build.VERSION.SDK_INT >= 24 && !info.isInvalidatedByBiometricEnrollment) return null
    return if (Build.VERSION.SDK_INT >= 31) {
      when (info.securityLevel) {
        KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
        KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "tee"
        else -> null
      }
    } else {
      @Suppress("DEPRECATION")
      if (info.isInsideSecureHardware) "tee" else null
    }
  }

  private fun signer(key: PrivateKey): Signature = Signature.getInstance("SHA256withECDSA").apply { initSign(key) }

  private fun state(): Map<String, Any> {
    if (!strongBiometric()) return mapOf("state" to "no_biometric")
    val ks = keyStore()
    if (!ks.containsAlias(ALIAS)) return mapOf("state" to "none")
    val key = ks.getKey(ALIAS, null) as? PrivateKey ?: return mapOf("state" to "lost")
    return try {
      signer(key)
      val level = levelOf(key) ?: return mapOf("state" to "lost")
      mapOf("state" to "ready", "publicKey" to hex(ks.getCertificate(ALIAS).publicKey.encoded), "level" to level)
    } catch (e: KeyPermanentlyInvalidatedException) {
      mapOf("state" to "lost")
    } catch (e: Exception) {
      // Fail closed: a key that can't be initialized is as good as lost; setting it up again makes a new one.
      mapOf("state" to "lost")
    }
  }

  private fun spec(strongBox: Boolean): KeyGenParameterSpec =
    KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setUserAuthenticationRequired(true)
      .apply {
        if (Build.VERSION.SDK_INT >= 30) {
          setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        } else {
          @Suppress("DEPRECATION")
          setUserAuthenticationValidityDurationSeconds(-1)
        }
        if (Build.VERSION.SDK_INT >= 24) setInvalidatedByBiometricEnrollment(true)
        if (strongBox && Build.VERSION.SDK_INT >= 28) setIsStrongBoxBacked(true)
      }
      .build()

  private fun generate() {
    val ks = keyStore()
    if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
    val kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    val strongBox = Build.VERSION.SDK_INT >= 28 && context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
    try {
      kpg.initialize(spec(strongBox))
      kpg.generateKeyPair()
    } catch (e: Exception) {
      // StrongBoxUnavailableException (or a StrongBox that can't do this key): the TEE instead.
      if (!strongBox) throw e
      kpg.initialize(spec(false))
      kpg.generateKeyPair()
    }
  }

  private fun destroy() {
    val ks = keyStore()
    if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
  }

  /** One prompt, one signature. Resolves the DER signature in hex; rejects with a code the app maps to copy. */
  private fun prompt(
    activity: FragmentActivity,
    signature: Signature,
    message: String,
    info: BiometricPrompt.PromptInfo,
    promise: Promise,
    onSigned: (String) -> Any?,
    onFailed: () -> Unit,
  ) {
    prompting = true
    val callback = object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
        prompting = false
        val sig = result.cryptoObject?.signature
        if (sig == null) {
          onFailed()
          promise.reject("failed", "No signature came back from the prompt.", null)
          return
        }
        try {
          sig.update(message.toByteArray(Charsets.UTF_8))
          promise.resolve(onSigned(hex(sig.sign())))
        } catch (e: KeyPermanentlyInvalidatedException) {
          onFailed()
          promise.reject("lost", "The approval key was retired.", e)
        } catch (e: Exception) {
          onFailed()
          promise.reject("failed", e.message, e)
        }
      }

      override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
        prompting = false
        onFailed()
        val code = when (errorCode) {
          BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_CANCELED -> "cancelled"
          BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "lockout"
          BiometricPrompt.ERROR_NO_BIOMETRICS, BiometricPrompt.ERROR_HW_NOT_PRESENT, BiometricPrompt.ERROR_HW_UNAVAILABLE -> "no_biometric"
          else -> "failed"
        }
        promise.reject(code, errString.toString(), null)
      }
      // A finger that doesn't match: the prompt stays open and says so itself.
    }
    BiometricPrompt(activity, ContextCompat.getMainExecutor(context), callback)
      .authenticate(info, BiometricPrompt.CryptoObject(signature))
  }

  private fun promptInfo(title: String, description: String?, cancel: String): BiometricPrompt.PromptInfo =
    BiometricPrompt.PromptInfo.Builder()
      .setTitle(title)
      .apply { if (description != null) setDescription(description) }
      .setNegativeButtonText(cancel)
      .setAllowedAuthenticators(BIOMETRIC_STRONG)
      .setConfirmationRequired(true)
      .build()

  override fun definition() = ModuleDefinition {
    Name("HermitApprovalKey")

    AsyncFunction("state") { state() }

    /**
     * Makes a new key (replacing any old one) and proves it with a fresh strong biometric: the new key signs the
     * enrollment challenge inside the prompt. Any failure leaves no key behind.
     */
    AsyncFunction("enroll") { message: String, locale: String, promise: Promise ->
      if (prompting) return@AsyncFunction promise.reject("busy", "A fingerprint prompt is already open.", null)
      if (!message.startsWith("${ApprovalText.ENROLL_DOMAIN}\n")) return@AsyncFunction promise.reject("bad_message", "Not an enrollment challenge.", null)
      if (!strongBiometric()) return@AsyncFunction promise.reject("no_biometric", "No strong biometric is enrolled.", null)
      val activity = appContext.currentActivity as? FragmentActivity
        ?: return@AsyncFunction promise.reject("no_activity", "Hermit isn't on screen.", null)
      val made = try {
        generate()
        val ks = keyStore()
        val key = ks.getKey(ALIAS, null) as PrivateKey
        levelOf(key)?.let { level -> NewKey(level, hex(ks.getCertificate(ALIAS).publicKey.encoded), signer(key)) }
      } catch (e: Exception) {
        destroy()
        return@AsyncFunction promise.reject("failed", e.message, e)
      }
      if (made == null) {
        destroy()
        return@AsyncFunction promise.reject("no_secure_hardware", "This phone can't keep the key in secure hardware.", null)
      }
      prompt(
        activity, made.signature, message, ApprovalText.strings(locale).let { s -> promptInfo(s.enrollTitle, s.enrollDescription, s.cancel) }, promise,
        onSigned = { sig -> mapOf("publicKey" to made.publicKey, "level" to made.level, "signature" to sig) },
        onFailed = { destroy() },
      )
    }.runOnQueue(Queues.MAIN)

    /** Signs one approval message. The prompt shows the amount and recipient (or the site) read from the message. */
    AsyncFunction("sign") { message: String, locale: String, promise: Promise ->
      if (prompting) return@AsyncFunction promise.reject("busy", "A fingerprint prompt is already open.", null)
      val approval = ApprovalText.parse(message) ?: return@AsyncFunction promise.reject("bad_message", "Not an approval Hermit signs.", null)
      if (approval.expiresAt <= System.currentTimeMillis()) return@AsyncFunction promise.reject("expired", "The approval expired.", null)
      if (!strongBiometric()) return@AsyncFunction promise.reject("no_biometric", "No strong biometric is enrolled.", null)
      val activity = appContext.currentActivity as? FragmentActivity
        ?: return@AsyncFunction promise.reject("no_activity", "Hermit isn't on screen.", null)
      val signature = try {
        val key = keyStore().getKey(ALIAS, null) as? PrivateKey ?: return@AsyncFunction promise.reject("lost", "No approval key.", null)
        if (levelOf(key) == null) return@AsyncFunction promise.reject("lost", "The approval key isn't usable.", null)
        signer(key)
      } catch (e: KeyPermanentlyInvalidatedException) {
        return@AsyncFunction promise.reject("lost", "The approval key was retired.", e)
      } catch (e: Exception) {
        return@AsyncFunction promise.reject("lost", e.message, e)
      }
      prompt(
        activity, signature, message,
        promptInfo(ApprovalText.title(approval, locale), ApprovalText.describe(approval, locale), ApprovalText.strings(locale).cancel), promise,
        onSigned = { sig -> sig },
        onFailed = {},
      )
    }.runOnQueue(Queues.MAIN)

    /** Delete everything (SL-26). Idempotent. */
    AsyncFunction("destroy") {
      destroy()
      null
    }
  }
}
