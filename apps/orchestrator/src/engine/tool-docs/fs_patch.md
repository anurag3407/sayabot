# fs_patch

## When to Use
- Applying multi-hunk edits or multi-file modifications atomically.
- Refactoring multiple files where partial application would break the codebase.
- Moving, creating, modifying, or deleting files in a single verified operation.

## When NOT to Use
- For simple single-line changes in one file where `fs_edit` is simpler.

## Format
A patch must be enclosed in `*** Begin Patch` and `*** End Patch`.
Inside the patch, you can declare one or more file operations:

### 1. Update Existing File
```
*** Update File: /home/bot/app/src/index.ts
@@ optional context anchor
 context line
-old line to remove
+new line to insert
```

### 2. Update and Move File
```
*** Update File: /home/bot/app/src/old.ts
*** Move to: /home/bot/app/src/new.ts
@@
-const a = 1;
+const a = 2;
```

### 3. Add New File
```
*** Add File: /home/bot/app/src/new-helper.ts
+export function helper() {
+  return true;
+}
```

### 4. Delete File
```
*** Delete File: /home/bot/app/src/deprecated.ts
```

## Atomic Verification Guarantee
All files and hunks are checked in memory before any writes or deletions take place.
If any hunk cannot be found or if any path is invalid, the entire operation is cancelled and zero files are changed on disk.
