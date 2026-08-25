import { z } from "zod"

import { ROLE_RANK, type ResolvedRole } from "@/authz"
import type { WorkflowInput } from "./workflowInputs"

// Declarative opt-in for manual (workflow_dispatch) actions, read from
// <classroom>/actions.json in the config repo.
//
// The app can discover every dispatchable workflow in <org>/classroom50, but
// discovery alone must never surface one: a custom workflow can do anything —
// push grades to an external system, mail students — so a workflow appears in
// the UI only because someone declared it here. Default deny, and adding a
// workflow to the repo exposes nothing by itself.
//
// The declaration carries policy only. Types (`type: boolean`, `required`,
// choice options) stay in the workflow YAML, so the two cannot drift: an input
// dropped from the YAML makes its policy entry irrelevant, and a new required
// input makes the action "needs configuration" rather than a standing 422.
export const ACTIONS_FILE = "actions.json"

// Workflows Classroom 50 ships and drives through their own affordances.
// Declaring one is refused rather than honored: `autograde-runner` isn't even
// dispatchable, and the others would appear twice with different behavior.
const BUILT_IN_WORKFLOWS = new Set([
  "collect-scores.yaml",
  "regrade.yaml",
  "publish-pages.yaml",
  "autograde-runner.yaml",
])
export const ACTIONS_SCHEMA = "classroom50/actions/v1"

// How one declared input reaches the dispatch:
// - locked: fixed value, not editable; the only policy that guarantees a value
//           the browser cannot change
// - shown:  an editable field, starting at the declaration's `value` or the
//           workflow's own default
// - hidden: not shown and NOT sent, so the workflow's default applies
export const INPUT_POLICIES = ["locked", "shown", "hidden"] as const
export type InputPolicy = (typeof INPUT_POLICIES)[number]

const InputPolicySchema = z.object({
  policy: z.enum(INPUT_POLICIES),
  // The fixed value for `locked` (nothing else supplies it) and the starting
  // value for `shown`; ignored for `hidden`. `{{classroom}}` is substituted
  // with the classroom the action runs from.
  value: z.string().optional(),
})

const ManualActionSchema = z.object({
  // Workflow file name inside .github/workflows (e.g. "moodle-sync.yaml").
  workflow: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  // Lowest classroom role allowed to run it. UX only — GitHub decides via
  // Actions write on the config repo — but the tier a workflow writes with is
  // worth stating next to the workflow, not inferring.
  min_role: z.enum(["teacher", "hta", "ta"]).default("teacher"),
  inputs: z.record(z.string(), InputPolicySchema).default({}),
})

// The array is read as unknown and each entry parsed on its own: one entry with
// a typo'd `min_role` must not take the classroom's other actions down with it.
const ActionsFileSchema = z.object({
  schema: z.literal(ACTIONS_SCHEMA),
  actions: z.array(z.unknown()).default([]),
})

export type ManualAction = z.infer<typeof ManualActionSchema>

/**
 * Parses <classroom>/actions.json.
 *
 * Returns [] for anything unusable — absent file, wrong schema string, a
 * hand-edit that broke the JSON. A broken declaration must degrade to "no
 * custom actions", never to a page that won't load, and never to an action
 * shown with a policy the file didn't actually express.
 */
export function parseActionsFile(raw: unknown): ManualAction[] {
  const file = ActionsFileSchema.safeParse(raw)
  if (!file.success) return []

  const seen = new Set<string>()
  const actions: ManualAction[] = []
  for (const entry of file.data.actions) {
    const parsed = ManualActionSchema.safeParse(entry)
    if (!parsed.success) continue
    // The workflows Classroom 50 drives itself already have their own buttons,
    // and a declared one would sit next to the built-in behaving differently.
    if (BUILT_IN_WORKFLOWS.has(parsed.data.workflow)) continue
    // Two entries for one workflow would render two menu items dispatching the
    // same thing; first declaration wins.
    if (seen.has(parsed.data.workflow)) continue
    seen.add(parsed.data.workflow)
    actions.push(parsed.data)
  }
  return actions
}

// "unresolved" (the role probe hasn't answered yet) fails closed: an action is
// offered only once the viewer is known to clear its declared minimum. The
// comparison goes through ROLE_RANK so a future staff tier ranks here the way
// it ranks everywhere else, instead of being denied by an unaware if-chain.
export function roleMeetsMinimum(
  role: ResolvedRole | undefined,
  minRole: ManualAction["min_role"],
): boolean {
  if (!role || role === "unresolved") return false
  return ROLE_RANK[role] >= ROLE_RANK[minRole]
}

// One input as the form should treat it, after the policy is applied to the
// workflow's own spec.
export type ResolvedInput = {
  spec: WorkflowInput
  policy: InputPolicy
  // Starting value for an editable field; the fixed value for a locked one.
  value: string
}

export type ActionProblem =
  // The declaration names a workflow that has no manual trigger, or no longer
  // exists in the repository.
  | "not-dispatchable"
  // The workflow requires an input the declaration neither supplies nor shows;
  // dispatching would 422 on every click.
  | "required-input-unavailable"
  // The declaration carries a policy for an input the workflow doesn't have —
  // a typo, or an input renamed since. Reported rather than ignored: a
  // misspelled `classroom` key would otherwise leave the scope unsent, and the
  // workflow's own "empty means everything" default would apply. That is the
  // widening `locked` exists to make impossible.
  | "unknown-input"
  // `locked` with nothing to lock to. Locking an input to no value says
  // nothing, and silently omitting it would hand the workflow its default —
  // the opposite of what locking promises.
  | "locked-without-value"

export type ResolvedAction =
  | { ok: true; action: ManualAction; inputs: ResolvedInput[] }
  | { ok: false; action: ManualAction; problem: ActionProblem }

const substitute = (value: string, classroom: string) =>
  value.replaceAll("{{classroom}}", classroom)

/**
 * Applies a declaration to the workflow's own input spec.
 *
 * `specs` is null for a workflow that cannot be dispatched at all — the caller
 * passes the parse result straight through, so every reason an action can't run
 * arrives as one `problem` rather than half here and half in the view.
 *
 * An input the declaration doesn't mention is `hidden`: silence must not
 * expose a field, least of all one whose empty value widens the run's scope
 * (a `classroom` input left blank means "every classroom" to more than one
 * workflow). The exception is a *required* input with no value in reach —
 * dispatching would 422, so the action is reported unusable instead.
 */
export function resolveAction(
  action: ManualAction,
  specs: WorkflowInput[] | null,
  classroom: string,
): ResolvedAction {
  if (!specs) return { ok: false, action, problem: "not-dispatchable" }

  const declaredNames = Object.keys(action.inputs)
  const specNames = new Set(specs.map((spec) => spec.name))
  if (declaredNames.some((name) => !specNames.has(name))) {
    return { ok: false, action, problem: "unknown-input" }
  }

  const inputs: ResolvedInput[] = []

  for (const spec of specs) {
    const policy: InputPolicy = action.inputs[spec.name]?.policy ?? "hidden"
    const declared = action.inputs[spec.name]?.value

    if (policy === "hidden") {
      // A required input the form never shows and the dispatch never sends is
      // a guaranteed 422 — surface it now, at the declaration, not per click.
      if (spec.required) {
        return { ok: false, action, problem: "required-input-unavailable" }
      }
      continue
    }

    if (policy === "locked") {
      const value = substitute(declared ?? "", classroom)
      // Checked for every locked input, not just required ones: an optional
      // input dropped for being empty would fall back to the workflow default,
      // which is exactly what locking is supposed to prevent.
      if (value === "") {
        return { ok: false, action, problem: "locked-without-value" }
      }
      inputs.push({ spec, policy, value })
      continue
    }

    // `shown` seeds from the declaration, else the workflow's own default —
    // and for a choice, else its first option, so the control never starts on
    // a value the workflow doesn't offer.
    const seed = declared ?? spec.default ?? spec.options?.[0] ?? ""
    inputs.push({ spec, policy, value: substitute(seed, classroom) })
  }

  return { ok: true, action, inputs }
}

/**
 * Builds the dispatch body from the resolved inputs and whatever the teacher
 * typed. Locked values are taken from the declaration, never from the form, so
 * a value fixed by the declaration cannot be widened by the client.
 *
 * An empty optional value is omitted rather than sent blank: to several
 * workflows a blank scope input reads as "everything".
 */
export function buildDispatchInputs(
  resolved: ResolvedInput[],
  entered: Record<string, string>,
): Record<string, string> {
  const body: Record<string, string> = {}
  for (const input of resolved) {
    // A locked value is always sent: it is non-empty by construction (see
    // `locked-without-value`), and dropping it would restore the workflow
    // default the declaration exists to override.
    if (input.policy === "locked") {
      body[input.spec.name] = input.value
      continue
    }
    const value = entered[input.spec.name] ?? input.value
    if (value === "" && !input.spec.required) continue
    body[input.spec.name] = value
  }
  return body
}
