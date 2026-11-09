/**
 * Heuristics to detect potentially destructive shell commands that warrant
 * a human approval prompt before executing inside a bot container.
 */
export function isDestructiveCommand(cmd: string): boolean {
  if (!cmd || typeof cmd !== "string") return false
  const trimmed = cmd.trim()

  // 1. Catastrophic deletion: rm -rf /, ~, or top-level home directories
  // Matches e.g. rm -rf /, rm -fr /home/bot, rm -r -f ~, etc.
  if (
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+([~/]|\/home\/?|\/home\/bot\/?|\/\*)/i.test(
      trimmed,
    ) ||
    /\brm\s+-[a-zA-Z]*r\w*\s+-[a-zA-Z]*f\w*\s+([~/]|\/home\/?|\/home\/bot\/?|\/\*)/i.test(
      trimmed,
    )
  ) {
    return true
  }

  // 2. Filesystem destruction / raw block writes
  if (/\bmkfs(\.[a-z0-9]+)?\b/i.test(trimmed)) {
    return true
  }
  if (/\bdd\s+.*of=\/dev\/(sd[a-z]|hd[a-z]|nvme|vd[a-z]|null|zero|urandom|loop)/i.test(trimmed)) {
    return true
  }

  // 3. Classic fork bombs
  if (/:\(\)\s*\{\s*:\|:&\s*\};:/i.test(trimmed) || /\.\/0\s*\|\s*\.\/0\s*&/i.test(trimmed)) {
    return true
  }

  // 4. Crypto-miners and known malware strains
  if (/\b(xmrig|minerd|cgminer|cpuminer|stratum\+tcp|stratum\+ssl)\b/i.test(trimmed)) {
    return true
  }

  // 5. Blind piping from web to shell: curl/wget ... | sh/bash/zsh/python
  if (/(curl|wget)\s+[^|]+\|\s*(sudo\s+)?(bash|sh|zsh|python|python3)/i.test(trimmed)) {
    return true
  }

  // 6. Direct attempts to format or overwrite block devices
  if (/\b(fdisk|parted|sfdisk|wipefs|shred)\s+\/dev\//i.test(trimmed)) {
    return true
  }

  // 7. Reverse shells and arbitrary network sockets
  if (
    /\b(nc|ncat|netcat)\b.*(-e|--exec|\/bin\/(ba)?sh)/i.test(trimmed) ||
    /\/dev\/(tcp|udp)\/[0-9a-z_.-]+\/[0-9]+/i.test(trimmed) ||
    /\bmkfifo\b.*\|.*(\/bin\/sh|bash|nc)/i.test(trimmed)
  ) {
    return true
  }

  // 8. Privilege escalation and container manipulation
  if (
    /\b(sudo|pkexec|setfacl)\b/i.test(trimmed) ||
    /\bchmod\s+[ug]\+s/i.test(trimmed) ||
    /\bsu(\s+-|\s+[a-z0-9_]+)/i.test(trimmed) ||
    /\b(mount|umount|chroot)\b/i.test(trimmed) ||
    /\/var\/run\/docker\.sock/i.test(trimmed)
  ) {
    return true
  }

  return false
}
