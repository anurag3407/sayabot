/**
 * The composer's "/" commands. Few on purpose: only the ones that make agents easier to drive.
 * `/goal` and `/btw` are sent as messages with `metadata.command` (the orchestrator loops a goal
 * and lets a side note through without interrupting); the rest act in the browser.
 */
export type SlashCommandName = "goal" | "btw" | "stop" | "model" | "todo" | "schedule" | "remember"

export interface SlashCommand {
  name: SlashCommandName
  /** What to type after the command, shown greyed in the menu; absent for commands that take none. */
  args?: string
  description: string
  /** Other spellings that run the same command. */
  aliases?: string[]
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "goal",
    args: "what to achieve",
    description: "Keep working, round after round, until it's done",
  },
  { name: "btw", args: "note", description: "Tell the bots something without interrupting them" },
  { name: "stop", description: "Stop what the bots are doing" },
  { name: "model", description: "Pick the model for this chat" },
  { name: "todo", args: "title", description: "Add a to-do" },
  { name: "schedule", args: "what to do", description: "Do this on a schedule", aliases: ["cron"] },
  { name: "remember", args: "fact", description: "Save a fact the bots always know" },
]

/** The command a message starts with, and the text after it; null when it isn't one. */
export function parseSlashCommand(input: string): { command: SlashCommand; rest: string } | null {
  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(input.trim())
  if (!match?.[1]) return null
  const word = match[1].toLowerCase()
  const command = SLASH_COMMANDS.find((item) => item.name === word || item.aliases?.includes(word))
  return command ? { command, rest: (match[2] ?? "").trim() } : null
}

/** Commands for the "/" menu while the first word is still being typed. */
export function slashSuggestions(input: string): SlashCommand[] {
  const match = /^\/([a-z]*)$/i.exec(input)
  if (!match) return []
  const query = (match[1] ?? "").toLowerCase()
  return SLASH_COMMANDS.filter(
    (item) => item.name.startsWith(query) || item.aliases?.some((alias) => alias.startsWith(query)),
  )
}
