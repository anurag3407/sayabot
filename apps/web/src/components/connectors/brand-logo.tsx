import { brandLogo } from "@/lib/brand-logos"

/** Vendor glyph for a connector. Renders nothing when we don't have that brand's mark. */
export function BrandLogo({
  id,
  size = 24,
  className,
}: {
  id: string
  size?: number
  className?: string
}) {
  const logo = brandLogo(id)
  if (!logo) return null
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}>
      <path fill={logo.color} d={logo.path} />
    </svg>
  )
}
