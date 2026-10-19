package com.youpi.observer;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class PaymentNotificationListenerService extends NotificationListenerService {
    private static final String TAG = "YoupiNotifListener";
    private ApiClient apiClient;

    private static final Pattern AMOUNT_PATTERN = Pattern.compile("(?:Rs\\.?|INR|₹)\\s*([0-9,]+(?:\\.[0-9]{1,2})?)", Pattern.CASE_INSENSITIVE);
    private static final Pattern UTR_PATTERN = Pattern.compile("(?:\\bUPI\\s*(?:ref(?:erence)?|txn(?:\\s*id)?|transaction(?:\\s*(?:id|ref(?:erence)?))?|id)|\\bref(?:erence)?\\s*(?:no\\.?|number)?|\\bUTR|\\bRRN|\\btxn(?:\\s*(?:id|ref))|\\btransaction\\s*(?:id|ref(?:erence)?))\\s*[:#-]?\\s*([A-Za-z0-9_-]{6,35})", Pattern.CASE_INSENSITIVE);
    private static final Pattern VPA_PATTERN = Pattern.compile("([a-zA-Z0-9._-]+@[a-zA-Z0-9]+)");

    @Override
    public void onCreate() {
        super.onCreate();
        apiClient = new ApiClient(this);
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || !apiClient.isPaired()) return;
        String sourcePackage = sbn.getPackageName();
        // Accept credit events only from known banking/UPI packages. A random app must
        // not be able to spoof a "payment received" notification into a successful donation.
        if (sourcePackage == null || !NotificationParser.INSTANCE.isRelevantPackage(sourcePackage)) return;

        Notification notif = sbn.getNotification();
        if (notif == null) return;

        Bundle extras = notif.extras;
        if (extras == null) return;

        CharSequence titleCs = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence textCs = extras.getCharSequence(Notification.EXTRA_TEXT);
        CharSequence bigTextCs = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);

        String title = titleCs != null ? titleCs.toString() : "";
        String text = textCs != null ? textCs.toString() : "";
        if (bigTextCs != null && bigTextCs.length() > text.length()) {
            text = bigTextCs.toString();
        }

        String full = (title + " " + text).toLowerCase();
        // Check if this looks like a credit / payment received notification
        if (!full.contains("received") && !full.contains("credited") && !full.contains("deposit") && !full.contains("paid you")) {
            return;
        }

        double amount = 0.0;
        Matcher mAmount = AMOUNT_PATTERN.matcher(title + " " + text);
        if (mAmount.find()) {
            try {
                String cleanNum = mAmount.group(1).replace(",", "");
                amount = Double.parseDouble(cleanNum);
            } catch (Exception ignored) {}
        }
        if (amount <= 0.0) return;

        String bankRef = null;
        Matcher mUtr = UTR_PATTERN.matcher(title + " " + text);
        if (mUtr.find()) {
            bankRef = mUtr.group(1);
        }

        String vpa = null;
        Matcher mVpa = VPA_PATTERN.matcher(title + " " + text);
        if (mVpa.find()) {
            vpa = mVpa.group(1);
        }

        final long amountPaise = Math.round(amount * 100);
        final double finalAmount = amount;
        final String finalBankRef = bankRef;
        final String finalVpa = vpa;
        final String finalTitle = title;
        final String finalTex = text;

        Log.i(TAG, "Captured candidate credit from " + sourcePackage + ": ₹" + amount + " reference present: " + (bankRef != null));

        new Thread(new Runnable() {
            @Override
            public void run() {
                apiClient.sendObservation(amountPaise, finalAmount, finalBankRef, finalVpa, finalTitle, finalTex);
            }
        }).start();
    }
}
