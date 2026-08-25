import { parseDocument } from "yaml"

// The `workflow_dispatch` input spec of a GitHub Actions workflow, read from
// the workflow YAML itself: GitHub's REST API exposes a workflow's id, name,
// path and state, but neither its triggers nor its inputs. Why the declaration
// deliberately does not carry them either is explained in ./manualActions.ts.
export type WorkflowInputType = "string" | "boolean" | "number" | "choice"

export type WorkflowInput = {
  name: string
  type: WorkflowInputType
  description?: string
  required: boolean
  default?: string
  // Only for `type: choice`; the allowed values in declaration order.
  options?: string[]
}

export type WorkflowDispatchSpec = {
  // The workflow's display name (`name:`), used when nothing else labels it.
  name?: string
  // Null when the workflow has no `workflow_dispatch` trigger at all — it can't
  // be a manual action, however it is declared.
  inputs: WorkflowInput[] | null
}

const INPUT_TYPES: WorkflowInputType[] = [
  "string",
  "boolean",
  "number",
  "choice",
]

// Read with the `core` schema (YAML 1.2): under 1.1 rules the `on:` key parses
// as the boolean `true`, while Actions itself reads it as a string.
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asString = (value: unknown): string | undefined => {
  if (typeof value === "string") return value
  // A YAML scalar default may parse as a boolean/number (`default: false`);
  // dispatch inputs travel as strings, so normalize here rather than at each
  // call site.
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value)
  }
  return undefined
}

function parseInput(name: string, raw: unknown): WorkflowInput {
  const spec = asRecord(raw) ?? {}
  const declared = asString(spec.type)
  const type = INPUT_TYPES.includes(declared as WorkflowInputType)
    ? (declared as WorkflowInputType)
    : "string"
  const options = Array.isArray(spec.options)
    ? spec.options.map(asString).filter((o): o is string => o !== undefined)
    : undefined

  return {
    name,
    type,
    description: asString(spec.description),
    required: spec.required === true,
    default: asString(spec.default),
    // A choice with no usable options is not dispatchable as a choice; leaving
    // `options` undefined makes the form fall back to a free-text field rather
    // than rendering an empty picker.
    options: type === "choice" && options?.length ? options : undefined,
  }
}

/**
 * Reads a workflow file's `name` and its `workflow_dispatch` input spec.
 *
 * Returns `inputs: null` for a workflow without the trigger (a `workflow_call`
 * helper, a push-only workflow) and `inputs: []` for one that takes no inputs —
 * the distinction matters, since the first can never be a manual action while
 * the second is dispatched with an empty body.
 *
 * Never throws: an unreadable or hand-mangled workflow degrades to "not
 * dispatchable" rather than breaking the page that lists actions.
 */
export function parseWorkflowDispatchSpec(
  source: string,
): WorkflowDispatchSpec {
  const doc = parseDocument(source, { schema: "core" })
  // `parseDocument` collects recoverable errors instead of throwing, so a
  // mangled file would otherwise come back as a partial document — the same
  // check util/yaml.ts makes for the same reason.
  if (doc.errors.length > 0) return { inputs: null }

  const root = asRecord(doc.toJS())
  if (!root) return { inputs: null }

  const name = asString(root.name)

  // Normalize the three shapes `on:` can take — a bare string, a list, a map —
  // so the trigger is looked up once rather than per shape.
  const on = root.on
  const triggers =
    typeof on === "string"
      ? { [on]: null }
      : Array.isArray(on)
        ? Object.fromEntries(on.map((key) => [String(key), null]))
        : asRecord(on)

  if (!triggers || !("workflow_dispatch" in triggers)) {
    return { name, inputs: null }
  }

  // `workflow_dispatch:` with nothing under it parses as null and `{}` as an
  // empty record — both mean "dispatchable, no inputs".
  const inputs = asRecord(asRecord(triggers.workflow_dispatch)?.inputs)
  if (!inputs) return { name, inputs: [] }

  return {
    name,
    inputs: Object.entries(inputs).map(([key, value]) =>
      parseInput(key, value),
    ),
  }
}
