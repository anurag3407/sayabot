"use client"

import { useState } from "react"
import { Cpu, HardDrive, Key, Layers, Radio, Server, Terminal, Zap } from "lucide-react"
import { saveOrgToolConfig } from "@/lib/actions/mcp"
import { ActionForm } from "@/components/ui/action-form"
import { Field, Input, Select } from "@/components/ui/field"
import type { OrgToolConfigView } from "@/lib/types"

export interface SandboxOption {
  id: string
  name: string
  tag: "Free / Local" | "Self-Hosted" | "Cloud / BYOK" | "HPC / MicroVM"
  isolation: string
  description: string
  hardware: {
    cpu: string
    ram: string
    gpu: string
  }
  cost: string
  requiresKey: boolean
  requiresHost: boolean
  keyLabel?: string
  keyPlaceholder?: string
  hostLabel?: string
  hostPlaceholder?: string
  docsUrl?: string
}

export const SANDBOX_OPTIONS: SandboxOption[] = [
  {
    id: "local",
    name: "Local (Host OS)",
    tag: "Free / Local",
    isolation: "Process Isolation (Scoped Directory & Timeout)",
    description:
      "Runs directly on the host machine (macOS, Linux, Windows WSL2). Fastest execution (<10ms), zero cloud cost, with full access to local dev dependencies.",
    hardware: {
      cpu: "Native Host Cores",
      ram: "Native Host Memory",
      gpu: "Local GPU (MPS / CUDA)",
    },
    cost: "$0.00 (Local Machine)",
    requiresKey: false,
    requiresHost: false,
  },
  {
    id: "docker",
    name: "Docker (Persistent Sandbox)",
    tag: "Self-Hosted",
    isolation: "Docker Container (Dropped Linux Capabilities)",
    description:
      "Persistent Linux container with dedicated /home/bot storage, Git worktree checkouts, and isolated networking via Sayabot computerd.",
    hardware: {
      cpu: "Configurable (1–16 Cores)",
      ram: "Configurable (1–32 GB RAM)",
      gpu: "NVIDIA Container Toolkit optional",
    },
    cost: "$0.00 (Self-Hosted)",
    requiresKey: false,
    requiresHost: true,
    hostLabel: "Computerd Daemon URL",
    hostPlaceholder: "http://computerd:4100",
  },
  {
    id: "modal",
    name: "Modal Labs (Serverless Cloud)",
    tag: "Cloud / BYOK",
    isolation: "Serverless Ephemeral Linux Container",
    description:
      "On-demand serverless cloud execution for heavy Python computation, AI models, and batch parallel simulations with instant GPU/CPU allocation.",
    hardware: {
      cpu: "Up to 64 vCPUs",
      ram: "Up to 256 GB RAM",
      gpu: "T4, A10G, A100, H100",
    },
    cost: "Pay-per-second (Billed to Modal account)",
    requiresKey: true,
    requiresHost: false,
    keyLabel: "Modal API Token",
    keyPlaceholder: "ak-…",
    docsUrl: "https://modal.com",
  },
  {
    id: "daytona",
    name: "Daytona (Cloud Workspaces)",
    tag: "Cloud / BYOK",
    isolation: "Standardized Cloud Dev Workspace",
    description:
      "Cloud developer environments with automated workspace provisioning, Git repository sync, and wake-on-demand resource management.",
    hardware: {
      cpu: "2–16 vCPUs",
      ram: "4–32 GB RAM",
      gpu: "Configurable",
    },
    cost: "Daytona Cloud / Self-Hosted Server",
    requiresKey: true,
    requiresHost: true,
    keyLabel: "Daytona API Key",
    keyPlaceholder: "dtn_…",
    hostLabel: "Workspace Server / ID",
    hostPlaceholder: "https://app.daytona.io or workspace-id",
    docsUrl: "https://daytona.io",
  },
  {
    id: "ssh",
    name: "Remote SSH (Homelab / VPS)",
    tag: "Self-Hosted",
    isolation: "Remote Server Execution over SSH",
    description:
      "Execute terminal commands on dedicated bare-metal servers, private homelabs, or cloud VPS instances via encrypted SSH channels.",
    hardware: {
      cpu: "Remote Target Server",
      ram: "Remote Target RAM",
      gpu: "Remote Target GPU",
    },
    cost: "$0.00 (Your hardware / VPS)",
    requiresKey: true,
    requiresHost: true,
    keyLabel: "SSH Private Key / Password",
    keyPlaceholder: "Paste private key or password",
    hostLabel: "SSH Host Connection",
    hostPlaceholder: "deploy@192.168.1.50:22",
  },
  {
    id: "serverless_vm",
    name: "Serverless MicroVM (E2B / Singularity)",
    tag: "HPC / MicroVM",
    isolation: "Firecracker MicroVM / Singularity Boundary",
    description:
      "Hardened microVM sandbox with sub-second spinup, kernel-level boundary separation, and zero access to host memory or networks.",
    hardware: {
      cpu: "2–4 vCPUs",
      ram: "4–8 GB RAM",
      gpu: "None",
    },
    cost: "Pay-as-you-go / E2B credits",
    requiresKey: true,
    requiresHost: false,
    keyLabel: "E2B API Key",
    keyPlaceholder: "e2b_…",
    docsUrl: "https://e2b.dev",
  },
]

export function TerminalSandboxConfig({
  orgSlug,
  savedConfig,
}: {
  orgSlug: string
  savedConfig?: OrgToolConfigView | null
}) {
  const [selectedBackend, setSelectedBackend] = useState<string>(
    savedConfig?.provider || "local",
  )
  const [apiKeyInput, setApiKeyInput] = useState<string>("")
  const [baseUrlInput, setBaseUrlInput] = useState<string>(savedConfig?.baseUrl || "")

  const activeOption =
    SANDBOX_OPTIONS.find((b) => b.id === selectedBackend) ?? SANDBOX_OPTIONS[0]!

  const hasSavedKey = Boolean(savedConfig?.last4 && savedConfig?.provider === selectedBackend)

  return (
    <div className="space-y-6">
      {/* 6 Interchangeable Backends Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SANDBOX_OPTIONS.map((backend) => {
          const isSelected = selectedBackend === backend.id

          return (
            <div
              key={backend.id}
              onClick={() => setSelectedBackend(backend.id)}
              className={`cursor-pointer rounded-lg border p-3.5 transition-all text-left flex flex-col justify-between ${
                isSelected
                  ? "border-accent bg-accent/5 ring-1 ring-accent"
                  : "border-line bg-raised/30 hover:border-line-strong hover:bg-raised/60"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-[13px] font-semibold text-text">{backend.name}</h4>
                  <span className="rounded-full bg-panel px-2 py-0.5 font-mono text-[10px] text-muted border border-line">
                    {backend.tag}
                  </span>
                </div>

                <p className="mt-1.5 text-[11px] text-muted line-clamp-2 leading-relaxed">
                  {backend.description}
                </p>

                <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-text">
                  <Layers className="h-3.5 w-3.5 text-accent shrink-0" />
                  <span className="line-clamp-1">{backend.isolation}</span>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-line/60">
                <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px] text-faint">
                  <span className="flex items-center gap-1">
                    <Cpu className="h-3 w-3 text-muted" />
                    {backend.hardware.cpu}
                  </span>
                  <span className="flex items-center gap-1">
                    <HardDrive className="h-3 w-3 text-muted" />
                    {backend.hardware.ram}
                  </span>
                </div>
                <div className="mt-1.5 font-mono text-[10px] text-accent/90">{backend.cost}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Configuration Form */}
      <ActionForm action={saveOrgToolConfig} submitLabel="Save Terminal Sandbox Settings">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="tool" value="terminal_sandbox" />
        <input type="hidden" name="provider" value={selectedBackend} />

        <div className="rounded-lg border border-line bg-raised/40 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
            <div>
              <h3 className="text-[13px] font-semibold text-text flex items-center gap-2">
                Configure {activeOption.name}
                <span className="rounded bg-panel px-2 py-0.5 font-mono text-[10px] text-muted border border-line">
                  {activeOption.isolation}
                </span>
              </h3>
              <p className="mt-0.5 text-[11px] text-muted">
                Agents with sandbox capability will execute all code and shell commands in this environment.
              </p>
            </div>
            {activeOption.docsUrl && (
              <a
                href={activeOption.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] text-accent hover:underline"
              >
                Docs ↗
              </a>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {activeOption.requiresHost && (
              <Field
                label={activeOption.hostLabel || "Host Endpoint"}
                htmlFor="sandbox-host"
                hint="Target host or server URL"
              >
                <Input
                  id="sandbox-host"
                  name="baseUrl"
                  value={baseUrlInput}
                  onChange={(e) => setBaseUrlInput(e.target.value)}
                  placeholder={activeOption.hostPlaceholder || "http://localhost:4100"}
                />
              </Field>
            )}

            {activeOption.requiresKey && (
              <Field
                label={activeOption.keyLabel || "API Key / Token"}
                htmlFor="sandbox-key"
                hint={hasSavedKey ? `Saved: •••• ${savedConfig?.last4}` : "Encrypted with AES-256-GCM"}
              >
                <Input
                  id="sandbox-key"
                  name="apiKey"
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={hasSavedKey ? "Leave blank to keep saved key" : activeOption.keyPlaceholder}
                />
              </Field>
            )}

            <Field label="State" htmlFor="sandbox-enabled">
              <Select
                id="sandbox-enabled"
                name="enabled"
                defaultValue={savedConfig?.enabled === false ? "false" : "true"}
              >
                <option value="true">Enabled (Agents execute in this environment)</option>
                <option value="false">Disabled</option>
              </Select>
            </Field>
          </div>
        </div>
      </ActionForm>
    </div>
  )
}
