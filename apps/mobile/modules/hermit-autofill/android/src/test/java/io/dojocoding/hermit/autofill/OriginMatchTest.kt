package io.dojocoding.hermit.autofill

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

/** SL-20: the same exact-origin vectors as packages/core/test/autofill-origin.test.ts, against the Kotlin mirror. */
class OriginMatchTest {
  private val vectors: JSONObject by lazy {
    var dir: File? = File(System.getProperty("user.dir")!!).absoluteFile
    while (dir != null) {
      val f = File(dir, "packages/core/test/autofill-origin-vectors.json")
      if (f.isFile) return@lazy JSONObject(f.readText())
      dir = dir.parentFile
    }
    fail("autofill-origin-vectors.json not found above ${System.getProperty("user.dir")}")
    throw IllegalStateException()
  }

  private fun strings(a: JSONArray) = (0 until a.length()).map { a.getString(it) }

  private fun allowlist(o: JSONObject) = o.keys().asSequence().associateWith { strings(o.getJSONArray(it)) }

  @Test
  fun sharedVectors() {
    val browsers = allowlist(vectors.getJSONObject("browsers"))
    val cases = vectors.getJSONArray("cases")
    assert(cases.length() > 0)
    for (i in 0 until cases.length()) {
      val c = cases.getJSONObject(i)
      val r = c.getJSONObject("request")
      val webArr = r.getJSONArray("web")
      val web = (0 until webArr.length()).map {
        val w = webArr.getJSONObject(it)
        WebNode(w.getString("domain"), if (w.has("scheme")) w.getString("scheme") else null)
      }
      val request = FillOrigin(r.getString("packageName"), strings(r.getJSONArray("certDigests")), web)
      val e = c.getJSONObject("expect")
      val expected = MatchResult(
        e.getBoolean("match"),
        if (e.has("origin")) e.getString("origin") else null,
        if (e.has("reason")) e.getString("reason") else null,
      )
      assertEquals(c.getString("name"), expected, OriginMatch.match(request, strings(c.getJSONArray("stored")), browsers))
    }
  }

  private fun request(r: JSONObject): FillOrigin {
    val webArr = r.getJSONArray("web")
    val web = (0 until webArr.length()).map {
      val w = webArr.getJSONObject(it)
      WebNode(w.getString("domain"), if (w.has("scheme")) w.getString("scheme") else null)
    }
    return FillOrigin(r.getString("packageName"), strings(r.getJSONArray("certDigests")), web)
  }

  /** SL-36: the same login vectors as `loginsFor` in packages/core/test/autofill-origin.test.ts. */
  @Test
  fun sharedLoginVectors() {
    val browsers = allowlist(vectors.getJSONObject("browsers"))
    val cases = vectors.getJSONArray("logins")
    assert(cases.length() >= 15)
    for (i in 0 until cases.length()) {
      val c = cases.getJSONObject(i)
      val idx = c.getJSONArray("index")
      val index = (0 until idx.length()).map {
        val e = idx.getJSONObject(it)
        LoginEntry(e.getString("ref"), e.getString("name"), strings(e.getJSONArray("origins")))
      }
      val e = c.getJSONObject("expect")
      val expected = LoginOffer(
        if (e.has("origin")) e.getString("origin") else null,
        if (e.has("reason")) e.getString("reason") else null,
        strings(e.getJSONArray("refs")),
      )
      assertEquals(c.getString("name"), expected, OriginMatch.loginsFor(request(c.getJSONObject("request")), index, browsers))
    }
  }

  @Test
  fun loginCapEqualsTheTypeScriptOne() {
    assertEquals(5, OriginMatch.LOGIN_MAX_OFFERED)
  }

  @Test
  fun shippedBrowserAllowlistEqualsTheTypeScriptOne() {
    assertEquals(allowlist(vectors.getJSONObject("productionBrowsers")), OriginMatch.TRUSTED_BROWSERS)
  }
}
