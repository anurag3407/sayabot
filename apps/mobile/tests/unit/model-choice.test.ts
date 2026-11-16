import assert from "node:assert/strict"
import { test } from "node:test"
import { buttonLabel, choiceLabel, fitEffort, type PickerGroup } from "../../src/core/model-choice.ts"

const groups: PickerGroup[] = [
  {
    keyId: null,
    provider: "saya",
    label: "Saya AI",
    detail: "Provided by this server",
    section: "server",
    effortLevels: [],
    models: [
      { id: "", label: "Automatic" },
      { id: "saya-opus", label: "Saya Opus" },
    ],
  },
  {
    keyId: "host:mac:claude-code",
    provider: "anthropic",
    label: "Claude",
    detail: "Anurag's MacBook",
    section: "mac",
    effortLevels: ["low", "high"],
    models: [{ id: "opus", label: "Claude Opus 5.5", effort: ["high"] }],
  },
]

test("names a server model and a Mac model the way the web picker does", () => {
  assert.equal(choiceLabel(groups, { keyId: null, model: "saya-opus", effort: null }), "Saya Opus")
  assert.equal(choiceLabel(groups, { keyId: "host:mac:claude-code", model: "opus", effort: null }), "Claude Opus 5.5 · Claude")
  assert.equal(buttonLabel(groups, { keyId: "host:mac:claude-code", model: "opus", effort: null }), "Claude Opus 5.5 · Mac")
  assert.equal(buttonLabel(groups, null), "Model")
})

test("drops an effort the new model does not take", () => {
  assert.equal(fitEffort(groups, "host:mac:claude-code", "opus", "low"), null)
  assert.equal(fitEffort(groups, "host:mac:claude-code", "opus", "high"), "high")
})
