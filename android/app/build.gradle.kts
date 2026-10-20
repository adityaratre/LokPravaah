plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

fun buildConfigString(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    // Release signing is enabled only when all signing secrets are supplied by CI.
    val releaseKeystore = System.getenv("APK_KEYSTORE_PATH")
    val releaseStorePassword = System.getenv("APK_KEYSTORE_PASSWORD")
    val releaseKeyAlias = System.getenv("APK_KEY_ALIAS")
    val releaseKeyPassword = System.getenv("APK_KEY_PASSWORD")

    signingConfigs {
        if (!releaseKeystore.isNullOrBlank() &&
            !releaseStorePassword.isNullOrBlank() &&
            !releaseKeyAlias.isNullOrBlank() &&
            !releaseKeyPassword.isNullOrBlank()
        ) {
            create("stableRelease") {
                storeFile = file(releaseKeystore)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    namespace = "online.lokpravaah.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "online.lokpravaah.app"
        minSdk = 24
        targetSdk = 35
        // Increment for each distributed build so Android recognises it as a newer version.
        versionCode = 3
        versionName = "1.0.2"

        // Only the Supabase project URL and public anon/publishable key belong here.
        // Never put service-role keys or AI provider secrets in an Android app.
        val supabaseUrl = providers.gradleProperty("SUPABASE_URL").orElse(providers.environmentVariable("SUPABASE_URL")).getOrElse("")
        val supabaseAnonKey = providers.gradleProperty("SUPABASE_ANON_KEY").orElse(providers.environmentVariable("SUPABASE_ANON_KEY")).getOrElse("")
        buildConfigField("String", "SUPABASE_URL", buildConfigString(supabaseUrl.trimEnd('/')))
        buildConfigField("String", "SUPABASE_ANON_KEY", buildConfigString(supabaseAnonKey))
    }

    buildTypes {
        release {
            if (signingConfigs.findByName("stableRelease") != null) {
                signingConfig = signingConfigs.getByName("stableRelease")
            }
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.webkit:webkit:1.12.1")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
