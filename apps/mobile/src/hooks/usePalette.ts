import { useSettings } from "./useSettings"
import { paletteFor } from "../theme"

export function usePalette() {
  const { settings } = useSettings()
  return paletteFor(settings.themeMode)
}
