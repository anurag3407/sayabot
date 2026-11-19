import { EventEmitter } from "node:events"

export const vaultEmitter = new EventEmitter()
vaultEmitter.setMaxListeners(100)

export function emitVaultChanged(payload = "{}"): void {
  vaultEmitter.emit("vault_changed", payload)
}
