import type { ReactNode } from "react"
import { cn, initials } from "@/lib/format"
import { Mascot } from "@/components/ui/mascot"

export function Avatar({
  name,
  kind,
  size = "md",
  src,
  className,
}: {
  name: string
  kind: "human" | "agent" | "system"
  size?: "sm" | "md" | "lg"
  src?: string | null
  className?: string
}) {
  const dimension =
    size === "sm" ? "h-6 w-6 text-[11px]" : size === "lg" ? "h-10 w-10 text-[13px]" : "h-7 w-7 text-[11px]"
  if (kind === "system") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "grid shrink-0 place-items-center rounded-sm border border-line bg-panel font-mono text-faint",
          dimension,
          className,
        )}
      >
        *
      </span>
    )
  }
  if (kind === "agent") {
    return <Mascot seed={name} className={cn("shrink-0", dimension, className)} />
  }
  return (
    <span
      aria-label={name}
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full border border-line-strong bg-raised font-mono font-medium text-text",
        dimension,
        className,
      )}
    >
      {src ? (
        <img src={src} alt="" aria-hidden="true" className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  )
}

export function AvatarStack({
  people,
  max = 5,
}: {
  people: { id: string; name: string; typing?: boolean }[]
  max?: number
}) {
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  return (
    <div className="flex items-center" aria-label={`${people.length} present`}>
      {shown.map((person, index) => (
        <span
          key={person.id}
          className={cn("relative", index > 0 && "-ml-1.5")}
          title={person.typing ? `${person.name} is typing` : person.name}
        >
          <Avatar
            name={person.name}
            kind="human"
            size="sm"
            className={cn(
              "ring-2 ring-panel",
              person.typing && "border-accent text-accent",
            )}
          />
        </span>
      ))}
      {rest > 0 ? (
        <span className="-ml-1.5 grid h-6 w-6 place-items-center rounded-full border border-line bg-panel font-mono text-[11px] text-muted ring-2 ring-panel">
          +{rest}
        </span>
      ) : null}
    </div>
  )
}

export function PresenceLine({
  people,
  selfId,
}: {
  people: { id: string; name: string; typing?: boolean }[]
  selfId?: string
}) {
  const typers = people.filter((p) => p.typing && p.id !== selfId)
  const others = people.filter((p) => p.id !== selfId)
  let text: ReactNode = null
  if (typers.length === 1) text = `${typers[0]!.name} is typing`
  else if (typers.length === 2) text = `${typers[0]!.name} and ${typers[1]!.name} are typing`
  else if (typers.length > 2) text = `${typers.length} people are typing`
  else if (others.length === 0) text = "only you here"
  else if (others.length === 1) text = `${others[0]!.name} is here`
  else text = `${others.length} others here`
  return <span className="font-mono text-[12px] text-faint">{text}</span>
}
