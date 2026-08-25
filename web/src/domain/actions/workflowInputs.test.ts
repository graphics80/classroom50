import { describe, expect, it } from "vitest"

import { parseWorkflowDispatchSpec } from "./workflowInputs"

describe("parseWorkflowDispatchSpec", () => {
  it("reads the inputs of a real dispatch workflow", () => {
    const spec = parseWorkflowDispatchSpec(`
name: Moodle Sync
on:
  workflow_dispatch:
    inputs:
      classroom:
        description: "Classroom; leer = alle"
        required: false
      dry_run:
        description: "Nur anzeigen"
        type: boolean
        default: false
      mode:
        type: choice
        options: [fast, full]
  schedule:
    - cron: "57 4 * * *"
jobs: {}
`)

    expect(spec.name).toBe("Moodle Sync")
    expect(spec.inputs?.map((i) => [i.name, i.type, i.required])).toEqual([
      ["classroom", "string", false],
      ["dry_run", "boolean", false],
      ["mode", "choice", false],
    ])
    // A YAML scalar default parses as a boolean; dispatch inputs travel as
    // strings, so the spec normalizes it.
    expect(spec.inputs?.[1].default).toBe("false")
    expect(spec.inputs?.[2].options).toEqual(["fast", "full"])
  })

  // `on` is the YAML 1.1 boolean `true`; reading with the core (1.2) schema is
  // what keeps it a string, as Actions itself reads it.
  it("does not lose the trigger to YAML's boolean `on`", () => {
    expect(
      parseWorkflowDispatchSpec("on: workflow_dispatch\njobs: {}").inputs,
    ).toEqual([])
  })

  it("treats a dispatch trigger without inputs as dispatchable", () => {
    expect(
      parseWorkflowDispatchSpec("on:\n  workflow_dispatch:\n").inputs,
    ).toEqual([])
    expect(
      parseWorkflowDispatchSpec("on:\n  workflow_dispatch: {}\n").inputs,
    ).toEqual([])
    expect(
      parseWorkflowDispatchSpec("on: [push, workflow_dispatch]\n").inputs,
    ).toEqual([])
  })

  it("reports a workflow with no manual trigger as not dispatchable", () => {
    expect(
      parseWorkflowDispatchSpec("on:\n  workflow_call:\n").inputs,
    ).toBeNull()
    expect(
      parseWorkflowDispatchSpec("on:\n  push:\n    branches: [main]\n").inputs,
    ).toBeNull()
    expect(parseWorkflowDispatchSpec("on: [push]\n").inputs).toBeNull()
  })

  it("degrades to not-dispatchable on unparseable input", () => {
    expect(parseWorkflowDispatchSpec("\tnot: [valid").inputs).toBeNull()
    expect(parseWorkflowDispatchSpec("").inputs).toBeNull()
  })

  it("falls back to a text field for a choice with no usable options", () => {
    const spec = parseWorkflowDispatchSpec(
      "on:\n  workflow_dispatch:\n    inputs:\n      mode:\n        type: choice\n",
    )
    expect(spec.inputs?.[0].type).toBe("choice")
    expect(spec.inputs?.[0].options).toBeUndefined()
  })
})
