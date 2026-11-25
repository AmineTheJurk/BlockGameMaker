// The "player" is an empty shell app: a full-screen WebView that runs web/player.html.
// The maker app embeds this APK as a template, then injects the user's game and re-signs it.
// IMPORTANT: applicationId and the label in the manifest are fixed-length placeholders that the
// maker app overwrites byte-for-byte (see ApkBuilder.kt). Do not change their length.
plugins {
    id("com.android.application")
}

android {
    namespace = "com.ckl.player"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.ckl.game.pppppppp"   // 8 placeholder characters, replaced per game
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // The maker app re-signs the APK, so this key only matters for building the template.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webassets"))
}

// Only the files a game needs. They end up in the APK under assets/web/.
val copyWeb by tasks.registering(Copy::class) {
    from(rootProject.file("web")) {
        include("lua.js", "blocks.js", "engine.js", "player.html", "game.js")
    }
    into(layout.buildDirectory.dir("generated/webassets/web"))
}
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach { dependsOn(copyWeb) }
