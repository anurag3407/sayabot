// The Android project is committed (bare workflow), where Expo rejects runtime version
// *policies*. Pin the runtime version to app.json's "version" instead: android/app/build.gradle
// reads the same field for versionName/versionCode and the expo_runtime_version resource, so an
// OTA update published from this config only ever reaches APKs built from the same version.
module.exports = ({ config }) => ({
  ...config,
  runtimeVersion: config.version,
})
