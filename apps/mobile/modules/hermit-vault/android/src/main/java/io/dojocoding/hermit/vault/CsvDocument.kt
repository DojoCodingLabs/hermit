package io.dojocoding.hermit.vault

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import expo.modules.kotlin.exception.CodedException

/**
 * SL-34: the CSV the user picks for a vault import, through the system document picker (ACTION_OPEN_DOCUMENT), so
 * Hermit needs no storage permission and sees only the one file the user chose, through the picker's URI grant.
 *
 * The content is read straight from the provider into memory: no copy in the cache, no temp file, no log line. The
 * read buffer is zeroed before returning; the copy handed to JavaScript is zeroed there once parsed (FR-VAULT-03).
 */
internal object CsvDocument {
  const val REQUEST_CODE = 4734

  /** CSV under the types providers report for it (Downloads often says text/comma-separated-values). */
  private val TYPES = arrayOf("text/csv", "text/comma-separated-values", "application/csv", "text/plain", "application/vnd.ms-excel")

  fun pickIntent(): Intent =
    Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      putExtra(Intent.EXTRA_MIME_TYPES, TYPES)
    }

  /** The picked file's name, size and whether its provider can delete it; never its content. */
  fun describe(context: Context, uri: Uri): Map<String, Any?> {
    val resolver = context.contentResolver
    var name: String? = null
    var size: Double? = null
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
      if (c.moveToFirst()) {
        if (!c.isNull(0)) name = c.getString(0)
        if (!c.isNull(1)) size = c.getLong(1).toDouble()
      }
    }
    return mapOf("uri" to uri.toString(), "name" to name, "size" to size, "canDelete" to canDelete(context, uri))
  }

  private fun canDelete(context: Context, uri: Uri): Boolean =
    try {
      DocumentsContract.isDocumentUri(context, uri) &&
        (context.contentResolver.query(uri, arrayOf(DocumentsContract.Document.COLUMN_FLAGS), null, null, null)?.use { c ->
          c.moveToFirst() && (c.getInt(0) and DocumentsContract.Document.FLAG_SUPPORTS_DELETE) != 0
        } ?: false)
    } catch (e: Exception) {
      false
    }

  /** At most `maxBytes`, or ERR_TOO_LARGE without reading further. */
  fun read(resolver: ContentResolver, uri: Uri, maxBytes: Int): ByteArray {
    val buffer = ByteArray(maxBytes + 1)
    try {
      var n = 0
      val input = resolver.openInputStream(uri) ?: throw CodedException("ERR_UNREADABLE", "The file can't be opened.", null)
      input.use {
        while (n < buffer.size) {
          val r = it.read(buffer, n, buffer.size - n)
          if (r < 0) break
          n += r
        }
      }
      if (n > maxBytes) throw CodedException("ERR_TOO_LARGE", "The file is over the import limit.", null)
      return buffer.copyOf(n)
    } catch (e: CodedException) {
      throw e
    } catch (e: Exception) {
      throw CodedException("ERR_UNREADABLE", "The file can't be read.", null)
    } finally {
      buffer.fill(0)
    }
  }

  /** Through the picker's grant; false when the provider refuses or doesn't support it. */
  fun delete(resolver: ContentResolver, uri: Uri): Boolean =
    try {
      DocumentsContract.deleteDocument(resolver, uri)
    } catch (e: Exception) {
      false
    }
}
