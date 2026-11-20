# fs_grep

Fast regex/text search across files using ripgrep (`rg`).

## When to Use

- Searching for function definitions, variable usages, imports, or errors across the project.
- Filtering by file type with `fileType` (e.g. `ts`, `json`, `py`).

## Example

```json
{
  "query": "function handleRequest",
  "path": "/home/bot/app/src",
  "fileType": "ts"
}
```
