import { brandLogo } from "@/lib/brand-logos"

/** Vendor glyph for a connector. Renders nothing when we don't have that brand's mark. */
export function BrandLogo({ id, size = 24 }: { id: string; size?: number }) {
  const logo = brandLogo(id)
  if (!logo) return null
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path fill={logo.color} d={logo.path} />
    </svg>
  )
}
