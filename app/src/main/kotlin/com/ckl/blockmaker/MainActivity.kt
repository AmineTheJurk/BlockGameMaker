package com.ckl.blockmaker

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.concurrent.thread

/** Hosts the editor (web/editor.html) in a WebView and gives it a small native bridge: `window.Android`. */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private var pageReady = false
    private var pendingImport: String? = null
    private var pendingExport: String? = null
    private var lastApk: File? = null

    private val projectsDir by lazy { File(filesDir, "projects").apply { mkdirs() } }

    private val openDoc = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) readAndSendImport(uri)
    }
    private val createDoc = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val text = pendingExport
        pendingExport = null
        if (uri != null && text != null) {
            try {
                contentResolver.openOutputStream(uri, "wt")!!.use { it.write(text.toByteArray(Charsets.UTF_8)) }
                toast("Saved your .ckl file")
            } catch (e: Exception) {
                toast("Could not save: ${e.message}")
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_NO_CACHE
        }
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                pageReady = true
                pendingImport?.let { sendToJs("imported", it); pendingImport = null }
            }
        }
        web.addJavascriptInterface(Bridge(), "Android")
        web.loadUrl("file:///android_asset/web/editor.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("(window.handleBack ? window.handleBack() : false)") { r ->
                    if (r != "true") finish()
                }
            }
        })
        handleViewIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleViewIntent(intent)
    }

    override fun onPause() { super.onPause(); web.evaluateJavascript("window.dispatchEvent(new Event('pagehide'))", null) }

    private fun handleViewIntent(i: Intent?) {
        val uri = i?.takeIf { it.action == Intent.ACTION_VIEW }?.data ?: return
        readAndSendImport(uri)
    }

    private fun readAndSendImport(uri: Uri) {
        thread {
            try {
                val bytes = contentResolver.openInputStream(uri)!!.use { it.readBytes() }
                if (bytes.size > 30_000_000) throw IllegalStateException("file is too big")
                val text = String(bytes, Charsets.UTF_8)
                runOnUiThread { if (pageReady) sendToJs("imported", text) else pendingImport = text }
            } catch (e: Exception) {
                toast("Could not open the file: ${e.message}")
            }
        }
    }

    private fun sendToJs(name: String, payload: String) {
        runOnUiThread {
            web.evaluateJavascript("window.onNative(${JSONObject.quote(name)},${JSONObject.quote(payload)})", null)
        }
    }

    private fun toast(msg: String) = runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_LONG).show() }

    private fun safeId(id: String): String = id.replace(Regex("[^A-Za-z0-9_-]"), "").take(64).ifEmpty { "game" }

    /** Methods callable from JavaScript as `Android.xxx(...)`. They run on a background thread. */
    inner class Bridge {
        @JavascriptInterface
        fun listProjects(): String {
            val arr = JSONArray()
            projectsDir.listFiles { f -> f.extension == "json" }?.forEach { f ->
                try {
                    val p = JSONObject(f.readText())
                    arr.put(JSONObject().put("id", p.optString("id", f.nameWithoutExtension)).put("name", p.optString("name", "My game"))
                        .put("updated", p.optLong("updated", f.lastModified())).put("objects", p.optJSONArray("objects")?.length() ?: 0))
                } catch (_: Exception) { /* skip broken file */ }
            }
            return arr.toString()
        }

        @JavascriptInterface
        fun loadProject(id: String): String = File(projectsDir, safeId(id) + ".json").takeIf { it.exists() }?.readText() ?: "null"

        @JavascriptInterface
        fun saveProject(id: String, json: String) {
            val f = File(projectsDir, safeId(id) + ".json")
            val tmp = File(projectsDir, safeId(id) + ".tmp")
            tmp.writeText(json)                       // write then rename, so a crash never leaves half a file
            if (!tmp.renameTo(f)) { f.writeText(json); tmp.delete() }
        }

        @JavascriptInterface
        fun deleteProject(id: String) { File(projectsDir, safeId(id) + ".json").delete() }

        @JavascriptInterface
        fun exportProject(name: String, json: String) {
            pendingExport = json
            runOnUiThread { createDoc.launch("$name.ckl") }
        }

        @JavascriptInterface
        fun importProject() { runOnUiThread { openDoc.launch(arrayOf("*/*")) } }

        @JavascriptInterface
        fun buildApk(json: String) {
            thread {
                val result = JSONObject()
                try {
                    val file = ApkBuilder(this@MainActivity).build(json)
                    lastApk = file
                    result.put("ok", true).put("message", "“${file.nameWithoutExtension.replace('_', ' ')}” is ready (${file.length() / 1024} KB).")
                } catch (e: Throwable) {
                    result.put("ok", false).put("message", "${e.javaClass.simpleName}: ${e.message}")
                }
                sendToJs("apk", result.toString())
            }
        }

        @JavascriptInterface
        fun installApk() {
            val f = lastApk ?: return
            runOnUiThread {
                if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
                    toast("Allow “install unknown apps” for Block Game Maker, then tap Install again.")
                    startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                    return@runOnUiThread
                }
                val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", f)
                startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }

        @JavascriptInterface
        fun shareApk() {
            val f = lastApk ?: return
            runOnUiThread {
                val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", f)
                val send = Intent(Intent.ACTION_SEND).setType("application/vnd.android.package-archive")
                    .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                startActivity(Intent.createChooser(send, "Share your game"))
            }
        }
    }
}
