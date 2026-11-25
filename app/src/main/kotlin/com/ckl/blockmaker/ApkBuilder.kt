package com.ckl.blockmaker

import android.content.Context
import com.android.apksig.ApkSigner
import org.json.JSONObject
import java.io.File
import java.io.FilterOutputStream
import java.io.OutputStream
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

/**
 * Turns a project into an installable game APK, entirely on the phone:
 *
 *  1. take the prebuilt "player" APK (assets/player_template.apk),
 *  2. add the game as assets/web/game.js,
 *  3. give it its own package name and app name (same-length byte replacement in the binary manifest),
 *  4. re-sign it (v1 + v2) with the key bundled in this app.
 */
class ApkBuilder(private val ctx: Context) {

    companion object {
        // Must match player/build.gradle.kts and player/src/main/AndroidManifest.xml exactly (same lengths!).
        const val PKG_PLACEHOLDER = "com.ckl.game.pppppppp"
        const val LABEL_PLACEHOLDER = "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    }

    fun build(projectJson: String): File {
        val project = JSONObject(projectJson)
        val name = cleanName(project.optString("name", "My Game"))
        val pkg = packageFor(project.optString("id", name))
        require(pkg.length == PKG_PLACEHOLDER.length) { "internal: package name length" }
        require(LABEL_PLACEHOLDER.length == 32)

        val dir = File(ctx.cacheDir, "apk").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val template = File(dir, "template.apk")
        ctx.assets.open("player_template.apk").use { i -> template.outputStream().use { i.copyTo(it) } }
        val unsigned = File(dir, "unsigned.apk")
        val out = File(dir, name.replace(' ', '_') + ".apk")

        rewrite(template, unsigned, pkg, name, "window.CKL_PROJECT = $projectJson;\n")
        template.delete()
        sign(unsigned, out)
        unsigned.delete()
        return out
    }

    // ------------------------------------------------------------------ names
    private fun cleanName(raw: String): String {
        val s = raw.replace(Regex("[^A-Za-z0-9 _.!-]"), "").trim().replace(Regex(" +"), " ").take(32).trim()
        return s.ifEmpty { "My Game" }
    }

    /** "com.ckl.game.g" + 7 hex characters taken from the project id: same game -> same package -> updates in place. */
    private fun packageFor(id: String): String {
        val md = MessageDigest.getInstance("MD5").digest(id.toByteArray(Charsets.UTF_8))
        val hex = md.joinToString("") { "%02x".format(it) }
        return "com.ckl.game.g" + hex.substring(0, 7)
    }

    // ------------------------------------------------------------------ zip rewrite
    private class CountingOut(out: OutputStream) : FilterOutputStream(out) {
        var count = 0L
        override fun write(b: Int) { out.write(b); count++ }
        override fun write(b: ByteArray, off: Int, len: Int) { out.write(b, off, len); count += len }
    }

    private fun rewrite(src: File, dst: File, pkg: String, name: String, gameJs: String) {
        val cos = CountingOut(dst.outputStream().buffered())
        ZipOutputStream(cos).use { zos ->
            ZipFile(src).use { zip ->
                for (e in zip.entries()) {
                    val n = e.name
                    if (e.isDirectory || n.startsWith("META-INF/") || n == "assets/web/game.js") continue
                    var data = zip.getInputStream(e).use { it.readBytes() }
                    if (n == "AndroidManifest.xml") {
                        data = replaceEverywhere(data, PKG_PLACEHOLDER, pkg)
                        data = replaceEverywhere(data, LABEL_PLACEHOLDER, name.padEnd(LABEL_PLACEHOLDER.length, ' '))
                    } else if (n == "resources.arsc") {
                        data = replaceEverywhere(data, PKG_PLACEHOLDER, pkg)
                    }
                    // resources.arsc (and anything that was stored uncompressed) stays uncompressed and 4-byte aligned,
                    // which Android 11+ requires.
                    put(zos, cos, n, data, stored = e.method == ZipEntry.STORED || n == "resources.arsc")
                }
            }
            put(zos, cos, "assets/web/game.js", gameJs.toByteArray(Charsets.UTF_8), stored = false)
        }
    }

    private fun put(zos: ZipOutputStream, cos: CountingOut, name: String, data: ByteArray, stored: Boolean) {
        val ze = ZipEntry(name)
        if (stored) {
            ze.method = ZipEntry.STORED
            ze.size = data.size.toLong()
            ze.compressedSize = data.size.toLong()
            ze.crc = CRC32().also { it.update(data) }.value
            // zipalign: file data must start at a multiple of 4. Local header = 30 bytes + name + extra.
            val base = cos.count + 30 + name.toByteArray(Charsets.UTF_8).size
            val pad = ((4 - (base % 4)) % 4).toInt()
            if (pad != 0) {
                val len = pad + 4                      // extra field = 2 (id) + 2 (size) + payload
                val extra = ByteArray(len)
                extra[0] = 0x35; extra[1] = 0xD9.toByte()   // 0xD935, the id zipalign uses for padding
                extra[2] = (len - 4).toByte()
                ze.extra = extra
            }
        } else {
            ze.method = ZipEntry.DEFLATED
        }
        zos.putNextEntry(ze)
        zos.write(data)
        zos.closeEntry()
    }

    /** Replaces [from] by [to] (same length!) in both UTF-8 and UTF-16LE form: binary XML and resource tables use either. */
    private fun replaceEverywhere(data: ByteArray, from: String, to: String): ByteArray {
        require(from.length == to.length) { "placeholder length mismatch" }
        var out = data
        for (cs in listOf(Charsets.UTF_8, Charsets.UTF_16LE)) out = replaceBytes(out, from.toByteArray(cs), to.toByteArray(cs))
        return out
    }

    private fun replaceBytes(data: ByteArray, from: ByteArray, to: ByteArray): ByteArray {
        require(from.size == to.size)
        val out = data.copyOf()
        var i = 0
        while (i <= out.size - from.size) {
            var match = true
            for (j in from.indices) if (out[i + j] != from[j]) { match = false; break }
            if (match) { System.arraycopy(to, 0, out, i, to.size); i += from.size } else i++
        }
        return out
    }

    // ------------------------------------------------------------------ signing
    private fun sign(input: File, output: File) {
        val key = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(ctx.assets.open("ckl_key.pk8").use { it.readBytes() }))
        val cert = ctx.assets.open("ckl_cert.der").use { CertificateFactory.getInstance("X.509").generateCertificate(it) as X509Certificate }
        val signer = ApkSigner.SignerConfig.Builder("ckl", key, listOf(cert)).build()
        ApkSigner.Builder(listOf(signer))
            .setInputApk(input)
            .setOutputApk(output)
            .setMinSdkVersion(24)
            .setV1SigningEnabled(true)
            .setV2SigningEnabled(true)
            .build()
            .sign()
    }
}
