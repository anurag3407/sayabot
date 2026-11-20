# fs_read

## When to Use

- Inspecting source code, config files, logs, or documentation.
- Before every `fs_edit`: the returned `hash` is the `expectedHash` that edit requires.
- Large files: read a page, then continue from `nextStartLine` while `hasMore` is true.

## When NOT to Use

- Binary files (images, archives, compiled binaries) are refused.
- To find files, use `fs_glob`; to find text across files, use `fs_grep`.
- For TypeScript/JavaScript structure, `code_outline` / `code_definition` are cheaper than reading whole files.

## Example

```json
{ "path": "/home/bot/app/src/index.ts", "startLine": 1, "endLine": 200 }
```

## Failure Modes

- `truncated: true` means you saw only part of the file. Never assume unseen lines.
- Lines are prefixed `N | ` for display only. Do not include the prefix in `fs_edit` oldString.
