import { cva, type VariantProps } from "class-variance-authority"
import type { ButtonHTMLAttributes } from "react"
import { cn } from "@/lib/format"

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "bg-accent text-void hover:bg-[var(--color-accent-strong)]",
        secondary: "border border-line-strong bg-raised text-text hover:bg-hover",
        outline: "border border-line text-text hover:border-line-strong hover:bg-raised",
        ghost: "text-muted hover:bg-raised hover:text-text",
        danger:
          "border border-[color-mix(in_srgb,var(--color-danger)_45%,transparent)] text-danger hover:bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)]",
        quiet: "text-muted hover:text-text",
      },
      size: {
        sm: "h-10 px-3 text-[13px] md:h-8 md:px-2.5 md:text-[12px]",
        md: "h-11 px-3.5 text-[13px] md:h-9",
        lg: "h-11 px-4 text-sm",
        icon: "h-11 w-11 md:h-9 md:w-9",
        "icon-sm": "h-10 w-10 md:h-7 md:w-7",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
}

export { buttonVariants }
