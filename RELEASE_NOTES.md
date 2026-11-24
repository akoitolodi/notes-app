## What's New in Notes by Bai v2.0.6

### 1. Instant Cold-Start Optimization (Zero Launch Lag)
- **Lazy Android Native TextToSpeech**: Stopped binding the system TTS service eagerly during `MainActivity.onCreate()` — Android native TTS now initializes lazily only when you tap Read Aloud / Study Commute.
- **Zero Blocking Splash Screen**: Removed the artificial JS splash screen and staggered Home tile entrance animations so Android's launch screen drops straight into an interactive frame-1 Home screen.
- **Frame-1 Instant Home Cache + Parallel DB Load**: Caches public Home counts & folders in `localStorage` (strictly excluding Hidden Vault folders) and loads Home DB queries in parallel inside a single batched React render.
- **Smaller Eager Boot Bundle (~72 KB Less JS Preloaded)**: Tree-shook `lucide-react` per screen instead of forcing all 15+ screens' icons into startup, lazy-loaded `@capacitor/local-notifications`, `canvasSync`, `netResilience`, and `templates`, and deferred background trash purge (`12h` throttled) and Canvas sync cleanly past the first 2–3 seconds.

### 2. Zero-Blur `Studio` Default + Opt-In Liquid Glass
- **`Studio` Is Now the Default Surface**: Clean matte cards with **zero GPU `backdrop-filter` blur** on chrome or toolbars for maximum launch speed and locked 60fps scrolling on every Android device.
- **Opt-In iOS 26 Liquid Glass**: Turn on **Frosted Glass** or **Aurora Glass** anytime inside **Themes & Palettes Studio** or **Settings → Appearance → Surface finish**.

> **Update Note**: Install `Notes-by-Bai.apk` directly over your current version (do not uninstall).
