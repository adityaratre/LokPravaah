plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

fun buildConfigString(value: String): String =
    "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "online.lokpravaah.app"
    compileSdk = 36

    defaultConfig {
        // Permanent package identity: keep this unchanged for all future updates.
        applicationId = "online.lokpravaah.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 9
        versionName = "1.2.3"

        val supabaseUrl = providers.gradleProperty("SUPABASE_URL")
            .orElse(providers.environmentVariable("SUPABASE_URL")).getOrElse("")
        val supabaseAnonKey = providers.gradleProperty("SUPABASE_ANON_KEY")
            .orElse(providers.environmentVariable("SUPABASE_ANON_KEY")).getOrElse("")
        buildConfigField("String", "SUPABASE_URL", buildConfigString(supabaseUrl.trimEnd('/')))
        buildConfigField("String", "SUPABASE_ANON_KEY", buildConfigString(supabaseAnonKey))
    }

    signingConfigs {
        getByName("debug") {
            storeFile = rootProject.file("debug-signing.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        // Test builds are isolated and must never be published as the final app.
        debug {
            applicationIdSuffix = ".test"
            versionNameSuffix = "-test"
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            isMinifyEnabled = false
            // Preserve the existing sideloaded CI signing identity for same-package updates.
            // Before Google Play publication, replace this development key with a private release key.
            signingConfig = signingConfigs.getByName("debug")
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
    buildFeatures { compose = true; buildConfig = true }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.browser:browser:1.8.0")
    implementation("com.google.zxing:core:3.5.3")
    implementation("org.osmdroid:osmdroid-android:6.1.20")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation(platform("io.github.jan-tennert.supabase:bom:3.5.0"))
    implementation("io.github.jan-tennert.supabase:auth-kt")
    implementation("io.github.jan-tennert.supabase:postgrest-kt")
    implementation("io.github.jan-tennert.supabase:storage-kt")
    implementation("io.ktor:ktor-client-android:3.0.3")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
}
