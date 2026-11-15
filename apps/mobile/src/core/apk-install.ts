import { Linking, Platform } from "react-native"
import * as FileSystem from "expo-file-system"
import * as IntentLauncher from "expo-intent-launcher"

const APK_MIME = "application/vnd.android.package-archive"
// Intent.FLAG_GRANT_READ_URI_PERMISSION: lets the system installer read our cached file.
const FLAG_GRANT_READ_URI_PERMISSION = 1

/**
 * Downloads a new APK into the app cache and hands it to Android's installer, which asks
 * the person to confirm (Android never lets a sideloaded app update itself silently).
 * Falls back to opening the link in the browser if anything in that path fails.
 */
export async function downloadAndInstallApk(
  url: string,
  version: string,
  onProgress: (fraction: number) => void,
): Promise<"installer" | "browser"> {
  if (Platform.OS !== "android" || !FileSystem.cacheDirectory) {
    await Linking.openURL(url)
    return "browser"
  }
  try {
    // Drop APKs left over from earlier updates (~35 MB each).
    const cached = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory).catch(() => [])
    await Promise.all(
      cached
        .filter((name) => /^Sayabot-.*\.apk$/.test(name))
        .map((name) =>
          FileSystem.deleteAsync(`${FileSystem.cacheDirectory}${name}`, { idempotent: true }),
        ),
    )
    const target = `${FileSystem.cacheDirectory}Sayabot-${version.replace(/[^0-9A-Za-z.-]/g, "")}.apk`
    const download = FileSystem.createDownloadResumable(url, target, {}, (p) => {
      if (p.totalBytesExpectedToWrite > 0) {
        onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite)
      }
    })
    const result = await download.downloadAsync()
    if (!result || result.status < 200 || result.status >= 300) {
      throw new Error(`Download failed (${result?.status ?? "no response"})`)
    }
    onProgress(1)
    const contentUri = await FileSystem.getContentUriAsync(result.uri)
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: contentUri,
      type: APK_MIME,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    })
    return "installer"
  } catch (err: unknown) {
    console.warn("[Updates] In-app APK install failed, opening browser:", err)
    await Linking.openURL(url)
    return "browser"
  }
}
