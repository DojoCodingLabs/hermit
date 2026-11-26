package io.dojocoding.hermit.intents

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

/**
 * FR-APP-01: starts the activity an intent spec describes (built and tested in @hermit/core, intents.ts). The other
 * app's own screen is where the person sends, calls, saves or confirms; nothing here completes an action.
 * React Native's Linking.sendIntent can't do this: it passes numbers as doubles (the alarm's hour is an int extra),
 * can't set a MIME type (the contact insert), and refuses without package-visibility queries.
 */
class HermitIntentsModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext) { "No React context" }

  override fun definition() = ModuleDefinition {
    Name("HermitIntents")

    /** Resolves "opened", or "no_app" when nothing on the phone handles it. */
    AsyncFunction("open") { specJson: String ->
      val spec = JSONObject(specJson)
      val action = spec.getString("action")
      require(action in ALLOWED) { "Intent action not allowed: $action" }
      val intent = Intent(action)
      val data = spec.optString("data").takeIf { it.isNotEmpty() }?.let(Uri::parse)
      val type = spec.optString("type").takeIf { it.isNotEmpty() }
      when {
        data != null && type != null -> intent.setDataAndType(data, type)
        data != null -> intent.data = data
        type != null -> intent.type = type
      }
      spec.optJSONObject("extras")?.let { extras ->
        for (key in extras.keys()) {
          when (val v = extras.get(key)) {
            is String -> intent.putExtra(key, v)
            is Boolean -> intent.putExtra(key, v)
            is JSONArray -> intent.putExtra(key, Array(v.length()) { i -> v.getString(i) })
          }
        }
      }
      spec.optJSONObject("intExtras")?.let { ints ->
        for (key in ints.keys()) intent.putExtra(key, ints.getInt(key))
      }
      val launch = if (spec.optBoolean("chooser")) Intent.createChooser(intent, null) else intent
      try {
        val activity = appContext.currentActivity
        if (activity != null) {
          activity.startActivity(launch)
        } else {
          launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          context.startActivity(launch)
        }
        "opened"
      } catch (e: ActivityNotFoundException) {
        "no_app"
      }
    }
  }

  companion object {
    /** Mirrors INTENT_ACTIONS in @hermit/core. ACTION_CALL is not here: Hermit never places a call. */
    private val ALLOWED = setOf(
      Intent.ACTION_VIEW,
      Intent.ACTION_SENDTO,
      Intent.ACTION_SEND,
      Intent.ACTION_DIAL,
      "android.intent.action.SET_ALARM",
      Intent.ACTION_INSERT,
    )
  }
}
