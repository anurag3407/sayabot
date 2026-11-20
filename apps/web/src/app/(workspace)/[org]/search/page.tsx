import type { Metadata } from "next"
import Link from "next/link"
import { requireOrgAccess } from "@/lib/auth"
import { searchMessages } from "@/lib/queries-ia"
import { EmptyState } from "@/components/ui/empty"
import { Input } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { fullTime } from "@/lib/format"

export const metadata: Metadata = { title: "Search" }

function Snippet({ content, query }: { content: string; query: string }) {
  const flat = content.replace(/\s+/g, " ").trim()
  const at = flat.toLowerCase().indexOf(query.toLowerCase())
  if (at === -1) return <>{flat.slice(0, 220)}</>
  const start = Math.max(0, at - 80)
  const end = Math.min(flat.length, at + query.length + 120)
  return (
    <>
      {start > 0 ? "…" : ""}
      {flat.slice(start, at)}
      <mark className="rounded-[2px] bg-accent-soft px-0.5 text-accent">
        {flat.slice(at, at + query.length)}
      </mark>
      {flat.slice(at + query.length, end)}
      {end < flat.length ? "…" : ""}
    </>
  )
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>
  searchParams: Promise<{ q?: string }>
}) {
  const { org: orgSlug } = await params
  const { q } = await searchParams
  const access = await requireOrgAccess(orgSlug)
  const query = (q ?? "").trim().slice(0, 200)
  const results = query.length >= 2 ? await searchMessages(access, query) : []

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
        <p className="font-mono text-[12px] text-faint">workspace</p>
        <h1 className="mt-1 text-2xl font-medium tracking-[-0.02em]">Search</h1>
        <form action={`/${orgSlug}/search`} role="search" className="mt-5 flex gap-2">
          <Input
            name="q"
            type="search"
            defaultValue={query}
            autoFocus
            placeholder="Search messages in your rooms"
            aria-label="Search messages"
          />
          <Button type="submit" variant="primary">
            Search
          </Button>
        </form>

        {query.length === 1 ? (
          <p className="mt-4 text-[13px] text-muted">Type at least two characters.</p>
        ) : null}

        {query.length >= 2 && results.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="No messages found"
              body={`Nothing in your rooms matches “${query}”. Try a shorter phrase.`}
            />
          </div>
        ) : null}

        {results.length ? (
          <>
            <p className="mt-6 font-mono text-[12px] text-faint">
              {results.length === 50 ? "first 50 results" : `${results.length} results`} · newest
              first
            </p>
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {results.map((result) => {
                const anchor = result.threadRootId ?? result.id
                const thread = result.threadRootId ? "&thread=1" : ""
                return (
                  <li key={result.id}>
                    <Link
                      href={`/${orgSlug}/r/${result.roomId}?m=${anchor}${thread}`}
                      className="block px-1 py-3 hover:bg-raised/50"
                    >
                      <span className="flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-faint">
                        <span className="text-muted">{result.roomName}</span>
                        <span>{result.senderName}</span>
                        {result.threadRootId ? <span>in a thread</span> : null}
                        <span className="ml-auto">{fullTime(result.createdAt)}</span>
                      </span>
                      <span className="mt-1 block text-[13px] leading-relaxed text-text">
                        <Snippet content={result.content} query={query} />
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  )
}
