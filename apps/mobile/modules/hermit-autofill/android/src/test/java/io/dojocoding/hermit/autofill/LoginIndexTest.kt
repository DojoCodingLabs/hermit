package io.dojocoding.hermit.autofill

import org.junit.Assert.assertEquals
import org.junit.Test

/** SL-36: the login index the service reads keeps only well-formed entries, and never anything but ref, name and origins. */
class LoginIndexTest {
  private val ref = "a".repeat(64)
  private val app = "android://bankTestCertDigest_000000000000000000000000@com.example.bank"

  @Test fun keepsRefNameAndExactOrigins() {
    val json = """[{"ref":"$ref","name":"Bank","origins":["https://bank.example","$app"],"username":"ana","secret":"pw"}]"""
    assertEquals(listOf(LoginEntry(ref, "Bank", listOf("https://bank.example", app))), LoginIndex.parse(json))
  }

  @Test fun dropsMalformedEntriesAndOrigins() {
    val json = """[
      {"ref":"item-1","name":"Bad ref","origins":["https://bank.example"]},
      {"ref":"$ref","name":"","origins":["https://bank.example"]},
      {"ref":"$ref","name":"Loose","origins":["bank.example","https://*.bank.example","https://Bank.example/login"]},
      {"ref":"$ref","name":"Ok","origins":["https://bank.example","HTTPS://BANK.EXAMPLE"]}
    ]"""
    assertEquals(listOf(LoginEntry(ref, "Ok", listOf("https://bank.example"))), LoginIndex.parse(json))
  }

  @Test fun anythingThatIsNotAnArrayIsEmpty() {
    for (bad in listOf(null, "", "{}", "not json", "[1,2]")) assertEquals(emptyList<LoginEntry>(), LoginIndex.parse(bad))
  }
}
