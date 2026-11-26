package io.dojocoding.hermit.contacts

import android.Manifest
import android.provider.ContactsContract.CommonDataKinds.Email
import android.provider.ContactsContract.CommonDataKinds.Nickname
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.Data
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

/**
 * PDR-028: reads the phone's contacts (name, nickname, numbers, addresses) for one lookup. The name matching is in
 * @hermit/core (people.ts), tested there; nothing here filters, caches or stores, and nothing leaves the phone.
 */
class HermitContactsModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext) { "No React context" }

  override fun definition() = ModuleDefinition {
    Name("HermitContacts")

    /** { status, granted, canAskAgain } without prompting. */
    AsyncFunction("getPermission") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.READ_CONTACTS)
    }

    /** The system prompt; only called when the user taps Allow. */
    AsyncFunction("requestPermission") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.READ_CONTACTS)
    }

    /** Every contact with a number or an address, as JSON: [{ name, nickname?, phones: [{ number, label? }], emails: [...] }]. */
    AsyncFunction("entries") {
      val byId = LinkedHashMap<Long, JSONObject>()
      val projection = arrayOf(Data.CONTACT_ID, Data.DISPLAY_NAME_PRIMARY, Data.MIMETYPE, Data.DATA1, Data.DATA2, Data.DATA3)
      val selection = "${Data.MIMETYPE} IN (?, ?, ?)"
      val args = arrayOf(Phone.CONTENT_ITEM_TYPE, Email.CONTENT_ITEM_TYPE, Nickname.CONTENT_ITEM_TYPE)
      context.contentResolver.query(Data.CONTENT_URI, projection, selection, args, null)?.use { c ->
        while (c.moveToNext()) {
          val id = c.getLong(0)
          val name = c.getString(1) ?: continue
          val value = c.getString(3) ?: continue
          val entry = byId.getOrPut(id) {
            JSONObject().put("name", name).put("phones", JSONArray()).put("emails", JSONArray())
          }
          val type = if (c.isNull(4)) 0 else c.getInt(4)
          val custom = c.getString(5)
          when (c.getString(2)) {
            Phone.CONTENT_ITEM_TYPE -> entry.getJSONArray("phones").put(
              JSONObject().put("number", value).put("label", Phone.getTypeLabel(context.resources, type, custom).toString()),
            )
            Email.CONTENT_ITEM_TYPE -> entry.getJSONArray("emails").put(
              JSONObject().put("address", value).put("label", Email.getTypeLabel(context.resources, type, custom).toString()),
            )
            Nickname.CONTENT_ITEM_TYPE -> entry.put("nickname", value)
          }
        }
      }
      JSONArray(byId.values).toString()
    }
  }
}
