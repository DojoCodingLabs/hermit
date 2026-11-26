package io.dojocoding.hermit.autofill

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

/** SL-35: the same form field vectors as packages/core/test/profile.test.ts, against the Kotlin mirror. */
class FieldKindTest {
  private val vectors: JSONObject by lazy {
    var dir: File? = File(System.getProperty("user.dir")!!).absoluteFile
    while (dir != null) {
      val f = File(dir, "packages/core/test/profile-field-vectors.json")
      if (f.isFile) return@lazy JSONObject(f.readText())
      dir = dir.parentFile
    }
    fail("profile-field-vectors.json not found above ${System.getProperty("user.dir")}")
    throw IllegalStateException()
  }

  private fun strings(a: JSONArray): List<String> = (0 until a.length()).map { a.getString(it) }

  @Test
  fun sharedVectors() {
    val cases = vectors.getJSONArray("cases")
    assert(cases.length() > 0)
    for (i in 0 until cases.length()) {
      val c = cases.getJSONObject(i)
      val f = c.getJSONObject("field")
      val htmlObj = f.getJSONObject("html")
      val html: Map<String, String> = htmlObj.keys().asSequence().associateWith { htmlObj.getString(it) }
      val field = FieldDescriptor(
        hints = strings(f.getJSONArray("hints")),
        html = html,
        idEntry = if (f.has("idEntry")) f.getString("idEntry") else null,
        hint = if (f.has("hint")) f.getString("hint") else null,
        inputType = f.getInt("inputType"),
      )
      val expected: String? = if (c.isNull("expect")) null else c.getString("expect")
      assertEquals(c.getString("name"), expected, FieldKinds.classify(field))
    }
  }

  @Test
  fun shippedTablesEqualTheTypeScriptOnes() {
    val hints = vectors.getJSONObject("hintKinds")
    val expectedHints: Map<String, String> = hints.keys().asSequence().associateWith { hints.getString(it) }
    assertEquals(expectedHints, FieldKinds.HINT_KINDS)
    val rules = vectors.getJSONArray("wordRules")
    val expectedRules = (0 until rules.length()).map {
      val r = rules.getJSONObject(it)
      val all = r.getJSONArray("all")
      WordRule(r.getString("kind"), strings(r.getJSONArray("any")), (0 until all.length()).map { g -> strings(all.getJSONArray(g)) })
    }
    assertEquals(expectedRules, FieldKinds.WORD_RULES)
  }

  @Test
  fun fieldCapEqualsTheRuntimeOne() {
    // The runtime refuses a request with more fields than this (FILL_MAX_FIELDS), so the service never offers more.
    assertEquals(vectors.getInt("maxFields"), ProfileFills.MAX_FIELDS)
  }

  @Test
  fun tokens() {
    assertEquals(
      listOf("billing", "address", "2", "numero", "de", "cedula", "e", "mail"),
      FieldKinds.tokens(listOf("billingAddress2", "Número de cédula", null, "E-mail")),
    )
  }
}
