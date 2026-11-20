# fs_edit

## When to Use

- Modifying existing code, fixing bugs, refactoring, or updating configuration.
- Prefer `fs_edit` over `fs_write` for existing files so unrelated content is never lost.

## When NOT to Use

- Creating new files (use `fs_write`).
- Without a fresh read: `expectedHash` must be the `hash` from your latest `fs_read` of this file (or from the previous `fs_edit` result).

## Example

```json
{
  "path": "/home/bot/app/src/server.ts",
  "oldString": "const port = 3000",
  "newString": "const port = 8080",
  "expectedHash": "<hash from fs_read>"
}
```

## Failure Modes

- `Stale hash`: the file changed since you read it. Read it again, then retry.
- `Could not find a match`: oldString must match byte-for-byte (without the `N | ` line prefixes). If only indentation differs, retry with `whitespace: true`.
- `Ambiguous match`: add surrounding lines to make oldString unique, or pass `replaceAll: true` to change every exact occurrence.
- Each successful edit returns a new `hash`; use it for the next edit to the same file.
