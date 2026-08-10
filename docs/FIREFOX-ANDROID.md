# Firefox for Android

MXGA ships one Firefox MV3 artifact for desktop and Android. The generated manifest declares separate compatibility floors:

```json
{
  "browser_specific_settings": {
    "gecko": { "strict_min_version": "140.0" },
    "gecko_android": { "strict_min_version": "142.0" }
  }
}
```

Firefox desktop 140 and Firefox Android 142 are the minimums because AMO's `data_collection_permissions` manifest taxonomy landed on those versions. Lowering either version makes `web-ext lint` report a compatibility warning.

## Build and validate

```bash
cd extension
npm ci
npm run test
npm run compile
npm run build:firefox-android
npm run lint:firefox-android
```

The lint gate tolerates existing generic `UNSAFE_VAR_ASSIGNMENT` warnings from generated bundles, but fails on validator errors, unsupported minimum versions, or `ANDROID_INCOMPATIBLE_API` findings.

## Test on a device

Install Android Platform Tools and enable:

1. Android developer options and USB debugging.
2. Firefox **Remote debugging via USB**.
3. USB authorization for the development machine.

Check the device:

```bash
adb devices
```

Build, then start Firefox Nightly with the extension temporarily loaded:

```bash
npm run build:firefox-android
npm run run:firefox-android -- \
  --adb-device YOUR_DEVICE_ID \
  --firefox-apk org.mozilla.fenix
```

Package names:

| Channel | Android package |
|---|---|
| Firefox | `org.mozilla.firefox` |
| Firefox Beta | `org.mozilla.firefox_beta` |
| Firefox Nightly | `org.mozilla.fenix` |

Nightly is recommended for development. Temporary loading ends when the development session stops.

## Publish through AMO

Building an Android-compatible manifest does not automatically enable Android distribution. During AMO submission:

1. Upload the Firefox ZIP/XPI produced by `npm run zip:firefox`.
2. Select **Firefox for Android** as a compatible platform.
3. Keep minimum Android version at 142 or later.
4. Test core flows on real mobile X before release: list sync, badges, local hide, settings, popup, and optional X mute/block permissions.

The UI already includes viewport metadata, coarse-pointer touch targets, safe-area handling, viewport-bounded cards/popovers, and responsive options navigation.
