# fs_write

Create a new file or deliberately overwrite an existing file.

## Anti-Truncation Protection
- If the target file already exists and is larger than 2 KB, `fs_write` will refuse to overwrite it unless you explicitly pass `"allowOverwriteLarge": true`.
- This prevents accidental truncation when you have only read a partial page of a file.
- Prefer `fs_edit` or `fs_patch` for modifying existing files.

## When to Use
- Writing new source files, scripts, or documentation.
- Complete rewrites of small files (< 50 lines).
- Deliberate full-file replacements of large files with `"allowOverwriteLarge": true`.

## When NOT to Use
- Do NOT use for small changes in large files (use `fs_edit` to avoid accidental deletion).

## Example
```json
{
  "path": "/home/bot/app/README.md",
  "content": "# Project Title\n\nOverview of the system...",
  "allowOverwriteLarge": false
}
```
