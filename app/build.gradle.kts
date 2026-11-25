plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.ckl.blockmaker"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.ckl.blockmaker"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = "1.8" }
    packaging { resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "META-INF/DEPENDENCIES") }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/assets"))
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.0")
    // Signs the finished game APK on the phone (v1 + v2 schemes).
    implementation("com.android.tools.build:apksig:8.5.2")
}

// 1) The whole web app (editor, engine, block guide) goes into assets/web.
val copyWeb by tasks.registering(Copy::class) {
    from(rootProject.file("web"))
    into(layout.buildDirectory.dir("generated/assets/web"))
}
// 2) The player APK is built first and embedded as the template for "Build Android app".
val copyPlayer by tasks.registering(Copy::class) {
    dependsOn(":player:assembleRelease")
    from(rootProject.file("player/build/outputs/apk/release/player-release.apk"))
    rename { "player_template.apk" }
    into(layout.buildDirectory.dir("generated/assets"))
}
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    dependsOn(copyWeb, copyPlayer)
}
