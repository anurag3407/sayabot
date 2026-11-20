"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Mascot } from "@/components/ui/mascot"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { PlusIcon, SearchIcon } from "@/components/ui/icons"
import { cn } from "@/lib/format"
import { CURATED_BOT_TEMPLATES } from "@/lib/curated-bot-templates"
import { Bot, Cable, Sparkles, Store, Terminal } from "lucide-react"

export interface BotTemplateItem {
  id: string
  slug: string
  name: string
  description: string
  category: string
  highlights?: string[]
  recommendedModel?: string
}

const CATEGORIES = [
  { id: "all", label: "All bots" },
  { id: "engineering", label: "Engineering" },
  { id: "research", label: "Research" },
  { id: "design", label: "Design" },
  { id: "writing", label: "Writing" },
  { id: "data", label: "Data" },
  { id: "ops", label: "Operations" },
  { id: "general", label: "General" },
]

export function BotStoreView({
  orgSlug,
  templates,
}: {
  orgSlug: string
  templates: BotTemplateItem[]
}) {
  const [query, setQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("all")

  // Combine curated fallback bots with any templates from DB
  const allTemplates = useMemo(() => {
    const list: BotTemplateItem[] = []
    const seenSlugs = new Set<string>()

    // Database templates first
    for (const t of templates) {
      if (t.slug === "blank") continue
      seenSlugs.add(t.slug)
      const curatedMatch = CURATED_BOT_TEMPLATES.find((c) => c.slug === t.slug)
      list.push({
        id: t.id,
        slug: t.slug,
        name: t.name,
        description: t.description || curatedMatch?.description || "Ready-to-use bot assistant.",
        category: t.category || curatedMatch?.category || "general",
        highlights: curatedMatch?.highlights ?? ["Ready-made", "Automated"],
        recommendedModel: curatedMatch?.recommendedModel,
      })
    }

    // Add any curated bots not yet in DB
    for (const curated of CURATED_BOT_TEMPLATES) {
      if (!seenSlugs.has(curated.slug)) {
        list.push({
          id: curated.id,
          slug: curated.slug,
          name: curated.name,
          description: curated.description,
          category: curated.category,
          highlights: curated.highlights,
          recommendedModel: curated.recommendedModel,
        })
      }
    }

    return list
  }, [templates])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    return allTemplates.filter((bot) => {
      const matchesCategory =
        selectedCategory === "all" || bot.category.toLowerCase() === selectedCategory.toLowerCase()
      const matchesQuery =
        !q ||
        bot.name.toLowerCase().includes(q) ||
        bot.description.toLowerCase().includes(q) ||
        bot.category.toLowerCase().includes(q) ||
        bot.highlights?.some((h) => h.toLowerCase().includes(q))
      return matchesCategory && matchesQuery
    })
  }, [allTemplates, selectedCategory, q])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
        {/* Header */}
        <header>
          <div className="flex items-center gap-2 text-accent">
            <Store className="h-5 w-5" />
            <span className="text-[13px] font-semibold uppercase tracking-wider">Bot Store</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-text">
            Ready-Made Bots
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Add specialized bots to your workspace. Each bot has a dedicated role, tools, and joins
            your rooms.
          </p>
        </header>

        {/* Navigation Switcher & Search Bar */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div
            role="tablist"
            aria-label="Workspace Store Navigation"
            className="flex rounded-lg border border-line bg-ink p-1"
          >
            <Link
              href={`/${orgSlug}/connectors`}
              role="tab"
              aria-selected={false}
              className="flex h-9 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-medium text-muted transition-colors hover:text-text"
            >
              <Cable className="h-3.5 w-3.5" />
              Connectors
            </Link>
            <Link
              href={`/${orgSlug}/bot-store`}
              role="tab"
              aria-selected={true}
              className="flex h-9 items-center gap-1.5 rounded-md bg-raised px-3.5 text-[13px] font-medium text-text transition-colors"
            >
              <Bot className="h-3.5 w-3.5" />
              Bot store
            </Link>
          </div>

          <div className="relative flex-1">
            <SearchIcon
              width={15}
              height={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search bots by role, name, or skills…"
              className="pl-9"
              aria-label="Search bots"
            />
          </div>

          <Link
            href={`/${orgSlug}/agents/new`}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-sm border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-text hover:bg-hover md:h-9"
          >
            <PlusIcon width={13} height={13} />
            New custom bot
          </Link>
        </div>

        {/* Category Filter Chips */}
        <div
          role="group"
          aria-label="Bot categories"
          className="-mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          {CATEGORIES.map((item) => {
            const count =
              item.id === "all"
                ? allTemplates.length
                : allTemplates.filter((b) => b.category.toLowerCase() === item.id).length
            return (
              <button
                key={item.id}
                aria-pressed={selectedCategory === item.id}
                onClick={() => setSelectedCategory(item.id)}
                className={cn(
                  "h-8 shrink-0 rounded-full border px-3 text-[12px] font-medium transition-colors",
                  selectedCategory === item.id
                    ? "border-line-strong bg-raised text-text"
                    : "border-line text-muted hover:text-text",
                )}
              >
                {item.label}
                <span className="ml-1 text-[11px] opacity-60">{count}</span>
              </button>
            )
          })}
        </div>

        {/* Bot Cards Grid */}
        <div className="mt-6">
          <div className="grid gap-3 md:grid-cols-2">
            {filtered.map((bot) => (
              <div
                key={bot.slug}
                className="group flex flex-col justify-between rounded-xl border border-line bg-panel p-4 transition-all hover:border-line-strong hover:bg-raised/40 hover:shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Mascot seed={bot.slug} className="h-11 w-11 shrink-0 rounded-xl" />
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-[15px] font-semibold text-text">{bot.name}</h2>
                          <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-faint">
                            {bot.category}
                          </span>
                        </div>
                        <p className="text-[12px] text-faint">by Sayabot</p>
                      </div>
                    </div>

                    <Link
                      href={`/${orgSlug}/agents/new?template=${encodeURIComponent(bot.slug)}`}
                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm bg-accent px-3 text-[12px] font-medium text-void transition-colors hover:bg-[var(--color-accent-strong)]"
                    >
                      <PlusIcon width={12} height={12} /> Add
                    </Link>
                  </div>

                  <p className="mt-3 text-[13px] leading-relaxed text-muted">{bot.description}</p>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-3">
                  {bot.highlights?.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-ink/80 px-2 py-0.5 text-[11px] text-muted"
                    >
                      {tag}
                    </span>
                  ))}
                  {bot.recommendedModel ? (
                    <span className="ml-auto text-[11px] text-faint">
                      Model: {bot.recommendedModel}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {!filtered.length ? (
            <div className="rounded-xl border border-dashed border-line p-8 text-center">
              <Bot className="mx-auto h-8 w-8 text-faint" />
              <p className="mt-2 text-[14px] font-medium text-text">
                No bots match &ldquo;{query}&rdquo;
              </p>
              <p className="mt-1 text-[13px] text-muted">
                Try a different search term or category filter.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setQuery("")
                  setSelectedCategory("all")
                }}
              >
                Clear search
              </Button>
            </div>
          ) : null}
        </div>

        {/* Bring Your Own Bot / Custom Agent Section */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-panel p-5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent">
              <Sparkles className="h-4 w-4" />
            </span>
            <h3 className="mt-3 text-[15px] font-medium text-text">Build a custom bot</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Design a tailored persona from scratch with custom instructions, provider keys, and
              fine-grained tool capabilities.
            </p>
            <Link
              href={`/${orgSlug}/agents/new`}
              className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
            >
              Start from scratch →
            </Link>
          </div>

          <div className="rounded-xl border border-line bg-panel p-5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-m-blue/10 text-m-blue">
              <Terminal className="h-4 w-4" />
            </span>
            <h3 className="mt-3 text-[15px] font-medium text-text">
              Invite external coding agents
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Claude Code, Hermes, Codex, and Cursor join your rooms as they are on their own plan.
              Just open a room and select &ldquo;Add agent&rdquo;.
            </p>
            <Link
              href={`/${orgSlug}`}
              className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
            >
              Go to your rooms →
            </Link>
          </div>
        </div>

        {/* Footer note linking to Connectors */}
        <div className="mt-8 flex flex-col gap-2 rounded-xl border border-line bg-ink p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Cable className="h-4 w-4 text-muted" />
            <p className="text-[13px] text-muted">
              Looking to connect external tools like GitHub, Slack, Notion, or Google Drive?
            </p>
          </div>
          <Link
            href={`/${orgSlug}/connectors`}
            className="shrink-0 text-[13px] font-medium text-accent hover:underline"
          >
            Explore Connectors →
          </Link>
        </div>
      </div>
    </div>
  )
}
