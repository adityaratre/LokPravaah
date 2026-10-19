package com.youpi.observer;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public class ApiClient {
    private static final String TAG = "YoupiApiClient";
    private static final String PREFS_NAME = "youpi_gateway_prefs";
    private static final String SECURE_PREFS_NAME = "youpi_observer_secure_prefs";
    private final SharedPreferences prefs;
    private final Context context;
    private volatile String lastPairError = "No pairing attempt has been made.";

    public ApiClient(Context context) {
        this.context = context.getApplicationContext();
        SharedPreferences selectedPrefs;
        SharedPreferences legacyPrefs = this.context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        try {
            String masterKeyAlias = androidx.security.crypto.MasterKeys.getOrCreate(
                androidx.security.crypto.MasterKeys.AES256_GCM_SPEC
            );
            SharedPreferences securePrefs = androidx.security.crypto.EncryptedSharedPreferences.create(
                SECURE_PREFS_NAME,
                masterKeyAlias,
                this.context,
                androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );

            // Migrate an existing device's pairing credentials once, so installing the
            // fixed build preserves pairing without continuing to keep the signing key in plaintext.
            if (!securePrefs.contains("device_id") && legacyPrefs.contains("device_id")) {
                SharedPreferences.Editor editor = securePrefs.edit();
                for (String key : new String[]{"base_url", "device_id", "signing_key", "merchant_id"}) {
                    String value = legacyPrefs.getString(key, null);
                    if (value != null) editor.putString(key, value);
                }
                editor.apply();
                legacyPrefs.edit().remove("device_id").remove("signing_key").remove("merchant_id").apply();
            }
            selectedPrefs = securePrefs;
        } catch (Exception e) {
            // Keep the app recoverable if the Android keystore is temporarily unavailable.
            // The paired-device token is never logged.
            Log.e(TAG, "Secure preference initialization failed; using the existing preference store for this session.", e);
            selectedPrefs = legacyPrefs;
        }
        this.prefs = selectedPrefs;
    }

    public boolean isPaired() {
        return prefs.getString("device_id", null) != null && prefs.getString("signing_key", null) != null;
    }

    public String getBaseUrl() {
        return prefs.getString("base_url", "http://10.0.2.2:6100");
    }

    public String getDeviceId() {
        return prefs.getString("device_id", "-");
    }

    public String getLastPairError() {
        return lastPairError;
    }

    public boolean pair(String baseUrl, String enrollmentToken, String deviceName) {
        // Leave merchantId unset for manual enrollment so the gateway can use its own
        // configured merchant ID. Hardcoding a client-side ID breaks pairing when the
        // deployment is configured for another merchant.
        return pair(baseUrl, enrollmentToken, deviceName, null, "v1", 0);
    }

    public boolean pair(String baseUrl, String enrollmentToken, String deviceName, String merchantId, String version, long expiresAt) {
        String cleanUrl = baseUrl == null ? "" : baseUrl.trim().replaceAll("/+$", "");
        String cleanToken = enrollmentToken == null ? "" : enrollmentToken.trim().replaceAll("\\s+", "");
        if (cleanUrl.isEmpty()) {
            lastPairError = "Enter the gateway URL.";
            return false;
        }
        if (!cleanToken.matches("(?i)^[a-f0-9]{64}$")) {
            lastPairError = "Enrollment token must be 64 hexadecimal characters. Generate a fresh pairing QR; do not reuse an expired token.";
            return false;
        }

        final String endpoint = cleanUrl + "/api/v1/pollers/android/pair";
        try {
            URL parsedUrl = new URL(endpoint);
            if (!("https".equalsIgnoreCase(parsedUrl.getProtocol()) || "http".equalsIgnoreCase(parsedUrl.getProtocol())) || parsedUrl.getHost().isEmpty()) {
                lastPairError = "Gateway URL must be a valid HTTP or HTTPS URL.";
                return false;
            }

            JSONObject body = new JSONObject();
            if (version != null && !version.trim().isEmpty()) body.put("version", version.trim());
            body.put("enrollmentToken", cleanToken);
            if (merchantId != null && !merchantId.trim().isEmpty()) body.put("merchantId", merchantId.trim());
            if (expiresAt > 0) body.put("expiresAt", expiresAt);
            body.put("deviceName", deviceName != null && !deviceName.trim().isEmpty() ? deviceName.trim() : Build.MODEL);
            body.put("deviceModel", Build.MANUFACTURER + " " + Build.MODEL);

            String response = postPairJson(endpoint, body.toString());
            if (response == null) return false;
            JSONObject json = new JSONObject(response);
            if (!json.optBoolean("paired", false)) {
                String error = json.optString("error", "").trim();
                String code = json.optString("code", "").trim();
                lastPairError = error.isEmpty() ? "Gateway did not confirm the pairing." : error;
                if (!code.isEmpty()) lastPairError += " (" + code + ")";
                return false;
            }

            String deviceId = json.getString("deviceId");
            String signingKey = json.getString("signingKey");
            String actualMerchantId = json.optString("merchantId", merchantId == null ? "" : merchantId);
            SharedPreferences.Editor editor = prefs.edit()
                .putString("base_url", cleanUrl)
                .putString("device_id", deviceId)
                .putString("signing_key", signingKey);
            if (!actualMerchantId.isEmpty()) editor.putString("merchant_id", actualMerchantId);
            editor.apply();

            lastPairError = "";
            Log.i(TAG, "Device pairing accepted by gateway: " + deviceId);
            return true;
        } catch (Exception e) {
            lastPairError = "Pairing could not be completed: " + e.getClass().getSimpleName() + ". Check the URL/network and try a fresh QR.";
            Log.e(TAG, "Pairing error: " + e.getClass().getSimpleName());
            return false;
        }
    }

    public boolean sendSms(String sender, String body, long timestamp) {
        if (!isPaired()) return false;

        String deviceId = prefs.getString("device_id", null);
        String signingKey = prefs.getString("signing_key", null);
        String baseUrl = getBaseUrl();
        String endpoint = baseUrl + "/api/v1/observers/sms";

        try {
            String tsStr = String.valueOf(timestamp > 0 ? timestamp : System.currentTimeMillis());
            JSONObject json = new JSONObject();
            json.put("deviceId", deviceId);
            json.put("sender", sender != null ? sender : "UNKNOWN");
            json.put("body", body != null ? body : "");
            json.put("timestamp", Long.parseLong(tsStr));

            String bodyString = json.toString();
            String sigPayload = bodyString + ":" + tsStr;
            String signature = calculateHmacSha256(sigPayload, signingKey);

            String response = postJson(endpoint, bodyString, deviceId, tsStr, signature);
            Log.i(TAG, "SMS dispatched to YouPI Gateway: " + (response != null ? "OK" : "FAILED"));
            return response != null;
        } catch (Exception e) {
            Log.e(TAG, "sendSms error: " + e.getMessage(), e);
        }
        return false;
    }

    public boolean sendObservation(long amountPaise, double amountRupees, String bankReferenceNumber, String senderVpa, String title, String text) {
        if (!isPaired()) return false;

        String deviceId = prefs.getString("device_id", null);
        String signingKey = prefs.getString("signing_key", null);
        String baseUrl = getBaseUrl();
        String endpoint = baseUrl + "/api/v1/pollers/android/events";

        try {
            String timestamp = String.valueOf(System.currentTimeMillis());
            JSONObject notification = new JSONObject();
            notification.put("title", title != null ? title : "");
            notification.put("text", text != null ? text : "");
            notification.put("bigText", text != null ? text : "");

            JSONObject body = new JSONObject();
            body.put("deviceId", deviceId);
            body.put("timestamp", Long.parseLong(timestamp));
            body.put("amountPaise", amountPaise);
            body.put("amount", amountRupees);
            body.put("bankReferenceNumber", bankReferenceNumber != null ? bankReferenceNumber : "");
            body.put("senderVpa", senderVpa != null ? senderVpa : "");
            body.put("direction", "credit");
            body.put("isCredit", true);
            body.put("notification", notification);
            body.put("body", (title != null ? title : "") + " " + (text != null ? text : ""));

            String bodyString = body.toString();
            String signature = calculateHmacSha256(bodyString + ":" + timestamp, signingKey);
            String response = postJson(endpoint, bodyString, deviceId, timestamp, signature);
            Log.i(TAG, "Credit notification dispatched to gateway: " + (response != null ? "OK" : "FAILED"));
            return response != null;
        } catch (Exception e) {
            Log.e(TAG, "sendObservation error: " + e.getClass().getSimpleName());
            return false;
        }
    }

    public boolean sendHeartbeat() {
        if (!isPaired()) return false;

        String deviceId = prefs.getString("device_id", null);
        String baseUrl = getBaseUrl();
        String endpoint = baseUrl + "/api/v1/pollers/android/heartbeat";

        try {
            JSONObject json = new JSONObject();
            json.put("deviceId", deviceId);
            json.put("timestamp", System.currentTimeMillis());
            json.put("batteryPercent", 100);
            json.put("isCharging", true);

            String response = postJson(endpoint, json.toString(), deviceId, null, null);
            return response != null;
        } catch (Exception e) {
            Log.e(TAG, "Heartbeat error: " + e.getMessage());
        }
        return false;
    }

    public boolean sendObservation(long amountPaise, double amount, String bankRef, String senderVpa, String title, String text) {
        if (!isPaired()) return false;

        String deviceId = prefs.getString("device_id", null);
        String signingKey = prefs.getString("signing_key", null);
        String baseUrl = getBaseUrl();
        String endpoint = baseUrl + "/api/v1/pollers/android/events";

        try {
            String tsStr = String.valueOf(System.currentTimeMillis());
            JSONObject raw = new JSONObject();
            raw.put("title", title != null ? title : "");
            raw.put("text", text != null ? text : "");

            JSONObject json = new JSONObject();
            json.put("deviceId", deviceId);
            json.put("amountPaise", amountPaise);
            json.put("amount", amount);
            json.put("bankReferenceNumber", bankRef);
            json.put("senderVpa", senderVpa);
            json.put("observedAt", System.currentTimeMillis());
            json.put("rawNotification", raw);

            String bodyString = json.toString();
            String sigPayload = bodyString + ":" + tsStr;
            String signature = calculateHmacSha256(sigPayload, signingKey);

            String response = postJson(endpoint, bodyString, deviceId, tsStr, signature);
            return response != null;
        } catch (Exception e) {
            Log.e(TAG, "sendObservation error: " + e.getMessage());
        }
        return false;
    }

    public void unpair() {
        prefs.edit().remove("device_id").remove("signing_key").apply();
    }

    private String postPairJson(String urlString, String jsonBody) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlString);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(12000);
            conn.setDoOutput(true);

            byte[] input = jsonBody.getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(input);
            }
            int code = conn.getResponseCode();
            InputStream stream = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
            StringBuilder responseText = new StringBuilder();
            if (stream != null) {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) responseText.append(line);
                }
            }

            if (code < 200 || code >= 300) {
                lastPairError = extractPairError(responseText.toString(), code);
                Log.w(TAG, "Pairing endpoint returned HTTP " + code);
                return null;
            }
            return responseText.toString();
        } catch (Exception e) {
            lastPairError = "Could not reach the gateway (" + e.getClass().getSimpleName() + "). Check internet and gateway URL.";
            Log.e(TAG, "Pairing request failed: " + e.getClass().getSimpleName());
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String extractPairError(String responseBody, int httpCode) {
        try {
            JSONObject json = new JSONObject(responseBody);
            String message = json.optString("error", "").trim();
            String code = json.optString("code", "").trim();
            if (!message.isEmpty()) return message + (code.isEmpty() ? "" : " (" + code + ")");
        } catch (Exception ignored) {
            // Some reverse proxies return a non-JSON error page; keep a useful HTTP status.
        }
        return "Gateway returned HTTP " + httpCode + (httpCode == 404 ? ". Check that the gateway route is deployed." : "");
    }

    private String postJson(String urlString, String jsonBody, String deviceId, String timestamp, String signature) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlString);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);

            if (deviceId != null) {
                conn.setRequestProperty("X-Device-Id", deviceId);
            }
            if (timestamp != null) {
                conn.setRequestProperty("X-Timestamp", timestamp);
            }
            if (signature != null) {
                conn.setRequestProperty("X-Signature", signature);
            }

            byte[] input = jsonBody.getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(input, 0, input.length);
            }

            int code = conn.getResponseCode();
            InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
            if (is == null) return null;

            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line);
                }
            }

            return (code >= 200 && code < 300) ? sb.toString() : null;
        } catch (Exception e) {
            Log.e(TAG, "postJson to " + urlString + " failed: " + e.getMessage());
            return null;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private String calculateHmacSha256(String data, String key) throws Exception {
        Mac sha256_HMAC = Mac.getInstance("HmacSHA256");
        SecretKeySpec secret_key = new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        sha256_HMAC.init(secret_key);
        byte[] rawHmac = sha256_HMAC.doFinal(data.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte b : rawHmac) {
            result.append(String.format("%02x", b));
        }
        return result.toString();
    }
}
