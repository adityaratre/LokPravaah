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
    // Supabase's Android Custom Tabs dependency requires API 36 at compile time.
    compileSdk = 36

    defaultConfig {
        applicationId = "online.lokpravaah.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "1.1.0"

        // Only the public Supabase publishable/anon key may be bundled in a client app.
        // The service-role key and provider secrets must stay on trusted servers.
        val supabaseUrl = providers.gradleProperty("SUPABASE_URL")
            .orElse(providers.environmentVariable("SUPABASE_URL")).getOrElse("")
        val supabaseAnonKey = providers.gradleProperty("SUPABASE_ANON_KEY")
            .orElse(providers.environmentVariable("SUPABASE_ANON_KEY")).getOrElse("")
        buildConfigField("String", "SUPABASE_URL", buildConfigString(supabaseUrl.trimEnd('/')))
        buildConfigField("String", "SUPABASE_ANON_KEY", buildConfigString(supabaseAnonKey))
    }

    buildTypes {
        release {
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
    buildFeatures { compose = true; buildConfig = true }
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
    // Shared Supabase identity/session for the native Android client.
    implementation(platform("io.github.jan-tennert.supabase:bom:3.5.0"))
    implementation("io.github.jan-tennert.supabase:auth-kt")
    implementation("io.github.jan-tennert.supabase:postgrest-kt")
    implementation("io.ktor:ktor-client-android:3.0.3")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
