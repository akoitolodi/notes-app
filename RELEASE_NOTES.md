## What's New in Notes by Bai v2.0.8

### Android Layout, Keyboard & Document Viewer Fixes
- **Fixed Top `"Note..."` ActionBar + Squished Splash Banner**: Moved Android window background initialization strictly past `super.onCreate(savedInstanceState)`, removed `android:background="@drawable/splash"` from `AppTheme.NoActionBarLaunch`, and added explicit `NoActionBar`/`NoTitle` attributes across launch & main themes.
- **Fixed Black Gap Above Keyboard & Header Scroll-Off**: Disabled duplicate Capacitor 8 `SystemBars` IME padding, handled `systemBars` + `ime` insets in a single native pass (`installCleanWindowInsets`), set `android:windowSoftInputMode="adjustResize"`, and locked `overflow: hidden` across `html, body, #root`, `.app-root`, and `.screen.screen-paper` so the `< Notes | Done | Explain` navbar and `.format-toolbar` stay pinned when typing.
- **Status & Nav Bar Icon Contrast**: Switched to `WindowInsetsControllerCompat` so system bar icons stay legible across Light, Dark, and OLED themes.
- **Document Viewer & Back Navigation Polish**: Prevented active PDF/embedded-image teardown when parent state re-renders, matched Dark/OLED themes with automatic `Night` reader theme default, fixed horizontal panning on zoomed PDFs, fixed valid `<button>` markup in attachment strips, and wired Android Back closing for Course Module document previews and Share sheets.

> **Update Note**: Install `Notes-by-Bai.apk` directly over your current version (do not uninstall).
