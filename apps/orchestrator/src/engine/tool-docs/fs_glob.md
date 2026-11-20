# fs_glob

Find files matching glob patterns in the container filesystem, sorted by modification time.

## When to Use

- Exploring repository structure or finding files by extension (e.g. `*.config.js`, `*.test.ts`).
- Discovering recently modified files.

## Example

```json
{
  "pattern": "*.test.ts",
  "path": "/home/bot/app"
}
```
