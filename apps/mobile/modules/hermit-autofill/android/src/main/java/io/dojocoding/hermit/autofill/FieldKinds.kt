package io.dojocoding.hermit.autofill

import java.text.Normalizer
import java.util.Locale

/**
 * A field as Android's AssistStructure describes it: never its current value, only what says what it is. `html` holds
 * the HTML attributes a browser reported, with lowercase names. `inputType` is the raw android.text.InputType.
 */
data class FieldDescriptor(
  val hints: List<String>,
  val html: Map<String, String>,
  val idEntry: String?,
  val hint: String?,
  val inputType: Int,
)

data class WordRule(val kind: String, val any: List<String>, val all: List<List<String>>)

/**
 * SL-35: the Kotlin mirror of `classifyField` in packages/core/src/profile.ts. Pure Kotlin (no Android types), so
 * FieldKindTest runs the shared vectors in packages/core/test/profile-field-vectors.json on the JVM and checks both
 * tables equal the vectors' tables. Change both files and the vectors together.
 *
 * `classify` returns a profile kind ("given_name", "full_name", ...), "password", or null when Hermit never fills it.
 */
object FieldKinds {
  val HINT_KINDS: Map<String, String> = mapOf(
    "password" to "password", "currentpassword" to "password", "newpassword" to "password",
    "username" to "skip", "newusername" to "skip", "smsotpcode" to "skip", "onetimecode" to "skip",
    "creditcardnumber" to "skip", "creditcardsecuritycode" to "skip", "creditcardexpirationdate" to "skip", "ccnumber" to "skip", "cccsc" to "skip", "ccexp" to "skip", "ccname" to "skip",
    "personmiddlename" to "skip", "additionalname" to "skip", "organization" to "skip",
    "name" to "full_name", "personname" to "full_name",
    "givenname" to "given_name", "persongivenname" to "given_name",
    "familyname" to "family_name", "personfamilyname" to "family_name",
    "email" to "email", "emailaddress" to "email",
    "tel" to "phone", "phone" to "phone", "phonenumber" to "phone", "phonenational" to "phone", "telnational" to "phone",
    "postaladdress" to "street_address", "streetaddress" to "street_address", "postaladdressstreetaddress" to "street_address", "addressline1" to "street_address",
    "addressline2" to "address_line2", "extendedaddress" to "address_line2", "postaladdressextendedaddress" to "address_line2",
    "addresslevel2" to "city", "addresslocality" to "city", "postaladdresslocality" to "city",
    "addresslevel1" to "region", "addressregion" to "region", "postaladdressregion" to "region",
    "postalcode" to "postal_code",
    "country" to "country", "countryname" to "country", "addresscountry" to "country", "postaladdresscountry" to "country",
    "bday" to "birth_date", "birthdatefull" to "birth_date",
  )

  val WORD_RULES: List<WordRule> = listOf(
    WordRule("password", listOf("password", "passwd", "pwd", "contrasena", "clave", "pin"), emptyList()),
    WordRule("skip", listOf("username", "usuario", "login", "otp", "captcha", "search", "buscar", "coupon", "cupon", "promo", "company", "empresa", "organization", "card", "tarjeta", "cvv", "cvc"), emptyList()),
    WordRule("passport_number", listOf("passport", "pasaporte"), emptyList()),
    WordRule("tax_id", listOf("rfc", "nit", "rut", "cuit", "cuil", "ruc", "taxid", "vat", "nif"), listOf(listOf("tax", "id"), listOf("tax", "number"))),
    WordRule("id_number", listOf("dni", "cedula", "curp", "ssn", "nationalid", "documento", "dui", "identificacion", "identification"), listOf(listOf("national", "id"), listOf("id", "number"), listOf("identity", "number"))),
    WordRule("email", listOf("email", "mail", "correo", "emailaddress"), emptyList()),
    WordRule("phone", listOf("phone", "tel", "telephone", "telefono", "mobile", "celular", "movil", "cell", "whatsapp"), emptyList()),
    WordRule("birth_date", listOf("birthday", "birthdate", "dob", "nacimiento", "cumpleanos"), listOf(listOf("birth", "date"), listOf("date", "birth"))),
    WordRule("postal_code", listOf("zip", "zipcode", "postal", "postcode", "postalcode", "cp"), emptyList()),
    WordRule("country", listOf("country", "pais"), emptyList()),
    WordRule("region", listOf("state", "province", "provincia", "region", "estado", "county"), emptyList()),
    WordRule("city", listOf("city", "ciudad", "town", "locality", "municipio", "localidad", "canton"), emptyList()),
    WordRule("address_line2", listOf("address2", "line2", "apartment", "apt", "suite", "unit", "interior", "depto"), listOf(listOf("address", "2"), listOf("line", "2"), listOf("direccion", "2"))),
    WordRule("street_address", listOf("address", "street", "direccion", "calle", "addr", "address1", "line1", "domicilio"), emptyList()),
    WordRule("full_name", listOf("fullname", "nombrecompleto"), listOf(listOf("full", "name"), listOf("nombre", "completo"))),
    WordRule("family_name", listOf("lastname", "surname", "familyname", "apellido", "apellidos", "lname"), listOf(listOf("last", "name"), listOf("family", "name"))),
    WordRule("given_name", listOf("firstname", "givenname", "fname", "nombre", "nombres"), listOf(listOf("first", "name"), listOf("given", "name"))),
    WordRule("full_name", listOf("name"), emptyList()),
  )

  private val SKIP_HTML_TYPES = setOf("hidden", "submit", "button", "reset", "checkbox", "radio", "file", "image", "range", "color", "search")

  private const val CLASS_MASK = 0x0f
  private const val VARIATION_MASK = 0xff0
  private const val CLASS_TEXT = 1
  private const val CLASS_NUMBER = 2
  private const val CLASS_PHONE = 3

  private val NOT_ALNUM = Regex("[^a-z0-9]")
  private val CAMEL = Regex("([a-z])([A-Z])")
  private val MARKS = Regex("[\\u0300-\\u036f]")
  private val LETTER_DIGIT = Regex("([a-z])([0-9])")
  private val DIGIT_LETTER = Regex("([0-9])([a-z])")
  private val SPLIT = Regex("[^a-z0-9]+")
  /** Exactly JavaScript's \s (Unicode spaces included); Java's \s is ASCII only. */
  private val SPACES = Regex("[\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+")

  private fun squash(s: String) = s.lowercase(Locale.ROOT).replace(NOT_ALNUM, "")

  /** Lowercase words without accents, split at camelCase, digits and punctuation. */
  fun tokens(texts: List<String?>): List<String> {
    val out = ArrayList<String>()
    for (raw in texts) {
      if (raw.isNullOrEmpty()) continue
      var s = raw.replace(CAMEL, "\$1 \$2")
      s = Normalizer.normalize(s, Normalizer.Form.NFD).replace(MARKS, "").lowercase(Locale.ROOT)
      s = s.replace(LETTER_DIGIT, "\$1 \$2").replace(DIGIT_LETTER, "\$1 \$2")
      for (w in s.split(SPLIT)) if (w.isNotEmpty()) out.add(w)
    }
    return out
  }

  private fun decided(v: String): String? = if (v == "skip") null else v

  fun classify(d: FieldDescriptor): String? {
    val hints = d.hints.map { squash(it) }
    if (hints.any { it.contains("password") }) return "password"
    for (h in hints) HINT_KINDS[h]?.let { return decided(it) }

    val auto = (d.html["autocomplete"] ?: "").split(SPACES).map { squash(it) }.filter { it.isNotEmpty() }
    if (auto.any { it.contains("password") }) return "password"
    for (h in auto.asReversed()) HINT_KINDS[h]?.let { return decided(it) }

    val type = (d.html["type"] ?: "").lowercase(Locale.ROOT)
    if (type == "password") return "password"
    if (type in SKIP_HTML_TYPES) return null
    if (type == "email") return "email"
    if (type == "tel") return "phone"

    val cls = d.inputType and CLASS_MASK
    val variation = d.inputType and VARIATION_MASK
    if (cls == CLASS_NUMBER && variation == 0x10) return "password"
    if (cls == CLASS_TEXT) {
      if (variation == 0x80 || variation == 0x90 || variation == 0xe0) return "password"
      if (variation == 0x20 || variation == 0xd0) return "email"
      if (variation == 0x60) return "full_name"
      if (variation == 0x70) return "street_address"
    }
    if (cls == CLASS_PHONE) return "phone"

    val words = tokens(listOf(d.idEntry, d.hint, d.html["name"], d.html["id"], d.html["placeholder"], d.html["label"], d.html["aria-label"])).toSet()
    for (rule in WORD_RULES) {
      if (rule.any.any { it in words } || rule.all.any { group -> group.all { it in words } }) return decided(rule.kind)
    }
    return null
  }
}
