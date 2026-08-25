import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Alert,
  Button,
  FormField,
  Input,
  Modal,
  Select,
  Spinner,
  ToggleField,
} from "@/components/ui"
import useWorkflowDispatchSpec from "@/hooks/useWorkflowDispatchSpec"
import {
  buildDispatchInputs,
  resolveAction,
  type ActionProblem,
  type ManualAction,
  type ResolvedInput,
} from "@/domain/actions/manualActions"
import useTriggerManualAction from "@/hooks/useTriggerManualAction"

// One message per reason an action can't run. Literal keys so the i18n audit
// sees them.
const PROBLEM_KEY: Record<ActionProblem, string> = {
  "not-dispatchable": "assignments.manualActions.notDispatchable",
  "required-input-unavailable": "assignments.manualActions.needsConfiguration",
  "unknown-input": "assignments.manualActions.unknownInput",
  "locked-without-value": "assignments.manualActions.lockedWithoutValue",
}

// Runs one declared manual action. The form is built from the workflow's own
// `workflow_dispatch` inputs, narrowed by the declaration's policy — so the
// fields a teacher sees, and the values they cannot touch, come from two
// sources that can't drift into each other.
export function ManualActionModal({
  org,
  classroom,
  action,
  onClose,
}: {
  org: string
  classroom: string
  action: ManualAction
  onClose: () => void
}) {
  const { t } = useTranslation()
  const specQuery = useWorkflowDispatchSpec(org, action.workflow)
  const trigger = useTriggerManualAction(
    org,
    classroom,
    action.workflow,
    action.label,
  )

  // One memo for the whole derivation: the spec's identity is stable (the query
  // selects through a module-level function), so this re-runs only when the
  // file or the classroom changes, not on every keystroke.
  const resolved = useMemo(
    () =>
      specQuery.data
        ? resolveAction(action, specQuery.data.inputs, classroom)
        : null,
    [action, classroom, specQuery.data],
  )

  const editable: ResolvedInput[] =
    resolved?.ok === true
      ? resolved.inputs.filter((input) => input.policy !== "locked")
      : []
  const locked: ResolvedInput[] =
    resolved?.ok === true
      ? resolved.inputs.filter((input) => input.policy === "locked")
      : []

  // Seeded once from the resolved starting values; the teacher's edits live
  // here. Locked inputs are deliberately absent — their value is read from the
  // declaration at dispatch, never from this state.
  const [entered, setEntered] = useState<Record<string, string>>({})
  const valueOf = (input: ResolvedInput) =>
    entered[input.spec.name] ?? input.value
  const setValue = (name: string, value: string) =>
    setEntered((prev) => ({ ...prev, [name]: value }))

  const missingRequired = editable.some(
    (input) => input.spec.required && valueOf(input).trim() === "",
  )

  const dispatching = trigger.phase === "dispatching"

  // The dialog stays open until the POST lands. Registration with the Actions
  // banner rides the dispatch's success, so a rejected POST (no Actions write
  // on the config repo, a workflow deleted between read and run) has no other
  // surface — closing on click would swallow it. Once the run is tracked, the
  // banner owns it and the dialog gets out of the way, including when the run
  // itself later fails: that outcome is the banner's to report, not this
  // dialog's.
  useEffect(() => {
    if (trigger.phase === "running") onClose()
  }, [trigger.phase, onClose])

  const run = () => {
    if (!resolved?.ok) return
    trigger.dispatch(buildDispatchInputs(resolved.inputs, entered))
  }

  return (
    <Modal open onClose={onClose} size="lg" closeDisabled={dispatching}>
      <h3 className="text-lg font-bold">{action.label}</h3>
      {action.description ? (
        <p className="mt-1 text-sm text-base-content/70">
          {action.description}
        </p>
      ) : null}

      {specQuery.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <Spinner size="xs" />
          {t("assignments.manualActions.loadingSpec")}
        </div>
      ) : null}

      {resolved?.ok === false ? (
        <Alert tone="error" className="mt-4">
          {t(PROBLEM_KEY[resolved.problem], {
            workflow: action.workflow,
          })}
        </Alert>
      ) : null}

      {trigger.phase === "failed" ? (
        <Alert tone="error" className="mt-4">
          {t("assignments.manualActions.dispatchFailed", {
            label: action.label,
            reason: trigger.error instanceof Error ? trigger.error.message : "",
          })}
        </Alert>
      ) : null}

      {resolved?.ok === true ? (
        <div className="mt-4 flex flex-col gap-4">
          {/* Locked values are shown but not editable: seeing the scope a run
              is about to use is the point — a teacher should be able to read
              "classroom: cs50" before pressing the button. */}
          {locked.length > 0 ? (
            <dl className="rounded-box bg-base-200 p-3 text-sm">
              {locked.map((input) => (
                <div key={input.spec.name} className="flex gap-2">
                  <dt className="font-mono opacity-70">{input.spec.name}</dt>
                  <dd className="font-mono">{input.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {editable.map((input) =>
            input.spec.type === "boolean" ? (
              // ToggleField carries its own label, so it replaces the field
              // wrapper rather than sitting inside one. Per Primer a toggle is
              // never marked required and takes no validation message.
              <ToggleField
                key={input.spec.name}
                id={`manual-action-${input.spec.name}`}
                checked={valueOf(input) === "true"}
                onChange={(checked) =>
                  setValue(input.spec.name, checked ? "true" : "false")
                }
                label={input.spec.name}
                help={input.spec.description}
              />
            ) : (
              <FormField
                key={input.spec.name}
                label={input.spec.name}
                required={input.spec.required}
                hint={input.spec.description}
              >
                {({ id }) =>
                  input.spec.options ? (
                    <Select
                      id={id}
                      value={valueOf(input)}
                      onChange={(e) =>
                        setValue(input.spec.name, e.target.value)
                      }
                    >
                      {input.spec.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      id={id}
                      type={input.spec.type === "number" ? "number" : "text"}
                      value={valueOf(input)}
                      onChange={(e) =>
                        setValue(input.spec.name, e.target.value)
                      }
                    />
                  )
                }
              </FormField>
            ),
          )}
        </div>
      ) : null}

      <div className="modal-action">
        <Button onClick={onClose} disabled={dispatching}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          onClick={run}
          loading={dispatching}
          disabled={resolved?.ok !== true || missingRequired}
        >
          {t("assignments.manualActions.run")}
        </Button>
      </div>
    </Modal>
  )
}

export default ManualActionModal
