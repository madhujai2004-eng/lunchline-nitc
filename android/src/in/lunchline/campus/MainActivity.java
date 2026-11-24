package in.lunchline.campus;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Native entry point. All campus data and authentication remain in the browser. */
public final class MainActivity extends Activity {
    public static final String APP_URL = "https://lunchline-campus-pilot.scentedtapir5.chatgpt.site/";
    private static final int FOREST = Color.rgb(35, 88, 63);
    private static final int INK = Color.rgb(30, 48, 37);
    private static final int MUTED = Color.rgb(95, 110, 99);
    private TextView connectionStatus;
    private TextView connectionDetail;
    private Button openButton;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        final ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(247, 248, 242));
        final LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_VERTICAL);
        content.setPadding(dp(28), dp(40), dp(28), dp(32));
        scroll.addView(content, new ScrollView.LayoutParams(-1, -1));
        setContentView(scroll);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            scroll.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }

        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.ic_launcher);
        mark.setContentDescription("LunchLine bowl logo");
        LinearLayout.LayoutParams markLayout = new LinearLayout.LayoutParams(dp(78), dp(78));
        markLayout.bottomMargin = dp(24);
        content.addView(mark, markLayout);
        TextView eyebrow = text("YOUR CAMPUS. YOUR BREAK.", 11, FOREST, true);
        eyebrow.setLetterSpacing(0.12f);
        add(content, eyebrow, 12);
        add(content, text("LunchLine", 38, INK, true), 8);
        add(content, text("Your break, made better.", 22, INK, false), 14);
        add(content, text("Open your campus kitchen, choose a bite and keep track of your order.", 16, MUTED, false), 28);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(20), dp(20), dp(20), dp(20));
        card.setBackground(shape(Color.WHITE, Color.rgb(219, 227, 216), 18));
        add(card, text("PRIVATE CAMPUS PILOT", 11, FOREST, true), 10);
        connectionStatus = text("Checking connection", 16, INK, true);
        add(card, connectionStatus, 6);
        connectionDetail = text("", 14, MUTED, false);
        add(card, connectionDetail, 18);
        openButton = new Button(this);
        openButton.setText("Open LunchLine");
        openButton.setTextSize(16);
        openButton.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        openButton.setAllCaps(false);
        openButton.setTextColor(Color.WHITE);
        openButton.setBackgroundTintList(android.content.res.ColorStateList.valueOf(FOREST));
        openButton.setMinHeight(dp(52));
        openButton.setOnClickListener(view -> openLunchLine());
        card.addView(openButton, new LinearLayout.LayoutParams(-1, dp(54)));
        Button retry = new Button(this, null, android.R.attr.borderlessButtonStyle);
        retry.setText("Check connection");
        retry.setAllCaps(false);
        retry.setTextColor(FOREST);
        retry.setMinHeight(dp(48));
        retry.setOnClickListener(view -> refreshConnection());
        card.addView(retry, new LinearLayout.LayoutParams(-1, dp(48)));
        add(content, card, 20);
        add(content, text("Uses your browser for secure sign-in. Your menus, orders and account stay online.", 13, MUTED, false), 12);
        add(content, text("Pilot build 1.0  ·  Test payments", 12, MUTED, false), 0);
    }

    @Override protected void onResume() {
        super.onResume();
        refreshConnection();
    }

    private void refreshConnection() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        Network active = manager == null ? null : manager.getActiveNetwork();
        NetworkCapabilities capabilities = active == null ? null : manager.getNetworkCapabilities(active);
        boolean available = capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        boolean validated = available && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        connectionStatus.setText(validated ? "Ready when you are" : available ? "Check your internet access" : "You’re offline");
        connectionDetail.setText(validated
                ? "Internet is connected. Continue to the live campus pilot."
                : "LunchLine needs an internet connection. Connect to Wi-Fi or mobile data, then try again.");
    }

    private void openLunchLine() {
        // Android browser Custom Tabs contract. A null session uses the browser's
        // existing profile and cookies; it does not create an embedded WebView.
        Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL));
        browser.addCategory(Intent.CATEGORY_BROWSABLE);
        Bundle customTabs = new Bundle();
        customTabs.putBinder("android.support.customtabs.extra.SESSION", null);
        browser.putExtras(customTabs);
        browser.putExtra("android.support.customtabs.extra.TOOLBAR_COLOR", FOREST);
        browser.putExtra("android.support.customtabs.extra.TITLE_VISIBILITY", 1);
        browser.putExtra("androidx.browser.customtabs.extra.SHARE_STATE", 2);
        try {
            startActivity(browser);
        } catch (ActivityNotFoundException missingBrowser) {
            connectionStatus.setText("A browser is needed");
            connectionDetail.setText("Install or enable Chrome, Firefox, Edge or another web browser, then open LunchLine again.");
        }
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLineSpacing(dp(3), 1.0f);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private void add(LinearLayout parent, View child, int bottomMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(bottomMargin);
        parent.addView(child, params);
    }

    private GradientDrawable shape(int fill, int stroke, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radius));
        drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private int dp(float amount) {
        return Math.round(amount * getResources().getDisplayMetrics().density);
    }
}
