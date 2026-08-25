import { describe, expect, it } from "vitest"

import {
  ACTIONS_SCHEMA,
  buildDispatchInputs,
  parseActionsFile,
  resolveAction,
  roleMeetsMinimum,
  type ManualAction,
} from "./manualActions"
import type { WorkflowInput } from "./workflowInputs"

const file = (actions: unknown[]) => ({ schema: ACTIONS_SCHEMA, actions })

const input = (over: Partial<WorkflowInput> = {}): WorkflowInput => ({
  name: "classroom",
  type: "string",
  required: false,
  ...over,
})

const action = (over: Partial<ManualAction> = {}): ManualAction => ({
  workflow: "moodle-sync.yaml",
  label: "Moodle-Sync",
  min_role: "teacher",
  inputs: {},
  ...over,
})

describe("parseActionsFile", () => {
  it("reads a declaration and applies the defaults", () => {
    const [parsed] = parseActionsFile(
      file([{ workflow: "moodle-sync.yaml", label: "Moodle-Sync" }]),
    )
    expect(parsed.min_role).toBe("teacher")
    expect(parsed.inputs).toEqual({})
  })

  // Every unusable shape reads as "no custom actions": a broken declaration
  // must never surface an action carrying a policy the file didn't express.
  it.each([
    [
      "a wrong schema string",
      { schema: "classroom50/actions/v2", actions: [] },
    ],
    ["a missing schema", { actions: [] }],
    ["a non-object", "nope"],
    [
      "an unknown policy",
      file([
        {
          workflow: "w.yaml",
          label: "W",
          inputs: { classroom: { policy: "readonly" } },
        },
      ]),
    ],
    ["an entry without a workflow", file([{ label: "W" }])],
  ])("returns nothing for %s", (_case, raw) => {
    expect(parseActionsFile(raw)).toEqual([])
  })

  // A mistake in one entry is that entry's problem: the classroom's other
  // actions must survive it.
  it("skips an unusable entry and keeps the rest", () => {
    const parsed = parseActionsFile(
      file([
        { workflow: "a.yaml", label: "A", min_role: "wizard" },
        { workflow: "b.yaml", label: "B" },
      ]),
    )
    expect(parsed.map((a) => a.workflow)).toEqual(["b.yaml"])
  })

  // Declaring one would put a second, differently-behaved button next to the
  // built-in affordance.
  it.each([
    "collect-scores.yaml",
    "regrade.yaml",
    "publish-pages.yaml",
    "autograde-runner.yaml",
  ])("refuses to declare the shipped %s", (workflow) => {
    expect(parseActionsFile(file([{ workflow, label: "Mine" }]))).toEqual([])
  })

  it("keeps the first declaration when a workflow repeats", () => {
    const parsed = parseActionsFile(
      file([
        { workflow: "w.yaml", label: "First" },
        { workflow: "w.yaml", label: "Second" },
      ]),
    )
    expect(parsed.map((a) => a.label)).toEqual(["First"])
  })
})

describe("roleMeetsMinimum", () => {
  it.each([
    ["teacher", "teacher", true],
    ["hta", "teacher", false],
    ["hta", "hta", true],
    ["ta", "hta", false],
    ["ta", "ta", true],
    ["student", "ta", false],
    ["unresolved", "ta", false],
  ] as const)("%s vs min_role %s", (role, min, expected) => {
    expect(roleMeetsMinimum(role, min)).toBe(expected)
  })

  it("fails closed with no role at all", () => {
    expect(roleMeetsMinimum(undefined, "ta")).toBe(false)
  })
})

describe("resolveAction", () => {
  it("substitutes {{classroom}} into a locked value", () => {
    const resolved = resolveAction(
      action({
        inputs: { classroom: { policy: "locked", value: "{{classroom}}" } },
      }),
      [input()],
      "m323-ix24",
    )
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.inputs[0]).toMatchObject({
      policy: "locked",
      value: "m323-ix24",
    })
  })

  // The rule that matters most: an undeclared input is not offered and not
  // sent. To more than one workflow a blank scope input reads as "everything".
  it("hides an input the declaration does not mention", () => {
    const resolved = resolveAction(
      action(),
      [input({ name: "classroom" }), input({ name: "user" })],
      "cs50",
    )
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.inputs).toEqual([])
  })

  it("reports a workflow with no manual trigger as unusable", () => {
    expect(resolveAction(action(), null, "cs50")).toMatchObject({
      ok: false,
      problem: "not-dispatchable",
    })
  })

  // The sharpest failure the format must catch: a misspelled key would leave
  // the scope unsent, and the workflow's "empty means everything" default would
  // apply — the widening `locked` is supposed to make impossible.
  it("refuses a declaration naming an input the workflow doesn't have", () => {
    const resolved = resolveAction(
      action({
        inputs: { classrom: { policy: "locked", value: "{{classroom}}" } },
      }),
      [input({ name: "classroom" })],
      "m323-ix24",
    )
    expect(resolved).toMatchObject({ ok: false, problem: "unknown-input" })
  })

  it.each([true, false])(
    "refuses a locked input with no value (required: %s)",
    (required) => {
      const resolved = resolveAction(
        action({ inputs: { target: { policy: "locked" } } }),
        [input({ name: "target", required })],
        "cs50",
      )
      expect(resolved).toMatchObject({
        ok: false,
        problem: "locked-without-value",
      })
    },
  )

  it("starts a choice with no default on its first option", () => {
    const resolved = resolveAction(
      action({ inputs: { mode: { policy: "shown" } } }),
      [input({ name: "mode", type: "choice", options: ["fast", "full"] })],
      "cs50",
    )
    if (!resolved.ok) throw new Error("expected a usable action")
    expect(resolved.inputs[0].value).toBe("fast")
  })

  it("reports an action whose required input is hidden as unusable", () => {
    const resolved = resolveAction(
      action(),
      [input({ name: "target", required: true })],
      "cs50",
    )
    expect(resolved).toMatchObject({
      ok: false,
      problem: "required-input-unavailable",
    })
  })

  it("reports a required input locked to an empty value as unusable", () => {
    const resolved = resolveAction(
      action({ inputs: { target: { policy: "locked", value: "" } } }),
      [input({ name: "target", required: true })],
      "cs50",
    )
    expect(resolved.ok).toBe(false)
  })

  it("starts a shown field at the workflow's own default", () => {
    const resolved = resolveAction(
      action({ inputs: { dry_run: { policy: "shown" } } }),
      [input({ name: "dry_run", type: "boolean", default: "false" })],
      "cs50",
    )
    if (!resolved.ok) throw new Error("expected a usable action")
    expect(resolved.inputs[0].value).toBe("false")
  })

  it("lets the declaration override that default", () => {
    const resolved = resolveAction(
      action({ inputs: { dry_run: { policy: "shown", value: "true" } } }),
      [input({ name: "dry_run", type: "boolean", default: "false" })],
      "cs50",
    )
    if (!resolved.ok) throw new Error("expected a usable action")
    expect(resolved.inputs[0].value).toBe("true")
  })
})

describe("buildDispatchInputs", () => {
  const resolved = (
    over: Partial<WorkflowInput>,
    policy: "locked" | "shown",
    value: string,
  ) => ({
    spec: input(over),
    policy,
    value,
  })

  it("takes a locked value from the declaration, never from the form", () => {
    const body = buildDispatchInputs(
      [resolved({ name: "classroom" }, "locked", "m323-ix24")],
      { classroom: "" },
    )
    expect(body).toEqual({ classroom: "m323-ix24" })
  })

  // Dropping it would hand the workflow its own default — for a scope input,
  // that is the org-wide run locking exists to prevent.
  it("sends a locked value even where an optional one would be dropped", () => {
    const body = buildDispatchInputs(
      [resolved({ name: "classroom", required: false }, "locked", "cs50")],
      {},
    )
    expect(body).toEqual({ classroom: "cs50" })
  })

  it("omits an empty optional value instead of sending it blank", () => {
    const body = buildDispatchInputs(
      [resolved({ name: "assignment" }, "shown", "")],
      { assignment: "" },
    )
    expect(body).toEqual({})
  })

  it("keeps an empty required value so the API, not the UI, rejects it", () => {
    const body = buildDispatchInputs(
      [resolved({ name: "target", required: true }, "shown", "")],
      { target: "" },
    )
    expect(body).toEqual({ target: "" })
  })
})
