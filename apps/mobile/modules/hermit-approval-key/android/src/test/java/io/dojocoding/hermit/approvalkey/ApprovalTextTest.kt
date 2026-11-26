package io.dojocoding.hermit.approvalkey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * SL-37: the fingerprint prompt reads the signed payload itself, with the module's own strings. Messages here are
 * exactly what `buildSignedApproval` makes (packages/cage/test/signed-approval.test.ts builds the same bytes).
 */
class ApprovalTextTest {
  private fun spend(value: String = "5000000", recipient: String = "0x1111111111111111111111111111111111111111", network: String = "eip155:2201") =
    "hermit.approval.v1\n" +
      "{\"amount\":{\"asset\":\"USDT\",\"network\":\"" + network + "\",\"value\":\"" + value + "\"},\"argsHash\":\"" + "c".repeat(64) +
      "\",\"domain\":\"hermit.approval.v1\",\"expiresAt\":1800000120000,\"issuedAt\":1800000000000,\"nonce\":\"" + "ab".repeat(32) +
      "\",\"recipient\":\"" + recipient + "\",\"requestId\":\"req-1\",\"risk\":\"spend\",\"skill\":\"pay\",\"v\":1}"

  @Test fun describesAPaymentFromThePayloadInTheModulesOwnWords() {
    val a = ApprovalText.parse(spend())!!
    assertEquals(1800000120000L, a.expiresAt)
    assertEquals("Monto: 5 USD₮\nPara: 0x1111111111111111111111111111111111111111\nRed: Stable testnet", ApprovalText.describe(a, "es-419"))
    assertEquals("Amount: 5 USD₮\nTo: 0x1111111111111111111111111111111111111111\nNetwork: Stable testnet", ApprovalText.describe(a, "en"))
    assertEquals("Aprueba este pago", ApprovalText.title(a, "es-419"))
    // An unknown locale is English, never text from the caller.
    assertEquals("Approve this payment", ApprovalText.title(a, "Amount: 1 USD₮"))
  }

  @Test fun namesTheNetworkFromThePayloadsIdOnly() {
    assertEquals("Stable testnet", ApprovalText.networkName("eip155:2201"))
    // Any other id is shown as it is, never renamed; a look-alike id with hidden characters is not Stable testnet.
    assertEquals("Network: eip155:1", ApprovalText.describe(ApprovalText.parse(spend(network = "eip155:1"))!!, "en").lines().last())
    assertEquals("Network: eip155:2201x", ApprovalText.describe(ApprovalText.parse(spend(network = "eip155:2201\\u202ex"))!!, "en").lines().last())
  }

  @Test fun anAmountOf1000AlwaysRenders1000() {
    val text = ApprovalText.describe(ApprovalText.parse(spend(value = "1000000000"))!!, "en")
    assertEquals("Amount: 1000 USD₮", text.lines().first())
  }

  @Test fun aRecipientWithBidiOverridesOrNewlinesRendersWithoutThem() {
    // U+202E (right-to-left override) and U+2066 (isolate) could reorder what is shown; \n could fake a line.
    val tricky = "0x1111\\u202e2222\\u2066333\\u2069\\nAmount: 1 USD₮"
    val text = ApprovalText.describe(ApprovalText.parse(spend(recipient = tricky))!!, "en")
    assertEquals("Amount: 5 USD₮\nTo: 0x11112222333Amount: 1 USD₮\nNetwork: Stable testnet", text)
    for (c in listOf('‮', '⁦', '⁩', '​')) assertFalse(text.contains(c))
    assertEquals(3, text.lines().size)
  }

  @Test fun cleanStripsControlAndFormatCharacters() {
    assertEquals("abc", ApprovalText.clean("a‪b​c\u0007"))
    assertEquals("https://bank.example", ApprovalText.clean("https://bank.example "))
  }

  @Test fun describesAPasswordBySite() {
    val cred = "hermit.approval.v1\n{\"argsHash\":\"" + "c".repeat(64) + "\",\"domain\":\"hermit.approval.v1\",\"expiresAt\":2,\"issuedAt\":1,\"nonce\":\"" +
      "ab".repeat(32) + "\",\"origin\":\"https://bank.example\",\"requestId\":\"r\",\"risk\":\"credential\",\"skill\":\"fill_password\",\"v\":1}"
    val a = ApprovalText.parse(cred)!!
    assertEquals("Sitio: https://bank.example", ApprovalText.describe(a, "es-419"))
    assertEquals("Approve using this password", ApprovalText.title(a, "en"))
  }

  /** SL-36: a login's payload, as `buildSignedApproval` makes it (keys in canonical order). */
  private fun login(origin: String, requester: String) =
    "hermit.approval.v1\n{\"argsHash\":\"" + "c".repeat(64) + "\",\"domain\":\"hermit.approval.v1\",\"expiresAt\":2,\"issuedAt\":1,\"item\":\"" +
      "d".repeat(64) + "\",\"nonce\":\"" + "ab".repeat(32) + "\",\"origin\":\"" + origin + "\",\"requestId\":\"r\",\"requester\":\"" + requester +
      "\",\"risk\":\"credential\",\"skill\":\"fill_login\",\"v\":1}"

  @Test fun describesALoginInABrowserBySiteAndBrowser() {
    val a = ApprovalText.parse(login("https://bank.example", "android://8P1sW0EPJcslw7UzRsiXL64w-O50Ed-RBICtay1g24M@com.android.chrome"))!!
    assertEquals("Site: https://bank.example\nBrowser: com.android.chrome", ApprovalText.describe(a, "en"))
    assertEquals("Sitio: https://bank.example\nNavegador: com.android.chrome", ApprovalText.describe(a, "es-419"))
  }

  @Test fun describesAnAppLoginByPackageAndSigningKey() {
    val app = "android://bankTestCertDigest_000000000000000000000000@com.example.bank"
    val a = ApprovalText.parse(login(app, app))!!
    assertEquals("App: com.example.bank\nSigning key: bankTestCertDigest_000000000000000000000000", ApprovalText.describe(a, "en"))
    assertEquals("App: com.example.bank\nClave de firma: bankTestCertDigest_000000000000000000000000", ApprovalText.describe(a, "es-419"))
  }

  @Test fun formatsBaseUnitsWithoutGroupingOrRounding() {
    assertEquals("5", ApprovalText.usdt("5000000"))
    assertEquals("1.5", ApprovalText.usdt("1500000"))
    assertEquals("0.000001", ApprovalText.usdt("1"))
    assertEquals("1234567.89", ApprovalText.usdt("1234567890000"))
  }

  @Test fun refusesAnythingElse() {
    assertNull(ApprovalText.parse(spend().replace("hermit.approval.v1\n", "hermit.other.v1\n")))
    assertNull(ApprovalText.parse(spend().replace("\"USDT\"", "\"USDC\"")))
    assertNull(ApprovalText.parse(spend(value = "-5")))
    assertNull(ApprovalText.parse(spend().replace(",\"recipient\":\"0x1111111111111111111111111111111111111111\"", "")))
    assertNull(ApprovalText.parse("hermit.approval.v1\nnot json"))
    assertNull(ApprovalText.parse("hermit.approval-key.enroll.v1\n{}"))
  }
}
