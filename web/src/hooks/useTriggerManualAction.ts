import { useGitHubClient } from "@/context/github/GitHubProvider"
import { useActionActivityRegistry } from "@/context/actions/ActionActivityProvider"

import { triggerManualWorkflow } from "@/github-core/mutations"
import { githubKeys } from "@/github-core/queries"
import { useGitHubOperation } from "./useGitHubOperation"

/**
 * Dispatches a declared manual action and tracks the run it created, reusing
 * the same primitive as the built-in collect/regrade dispatchers — run binding
 * by monotonic id, sessionStorage persistence across remounts, registration
 * with the app-wide Actions banner.
 *
 * `label` is the declaration's label: the banner's workflow labels are a fixed
 * map of the four scaffolded workflows, and a custom workflow has no entry
 * there, so the name the teacher declared is what the banner shows.
 */
const useTriggerManualAction = (
  org: string | undefined,
  classroom: string | undefined,
  workflow: string,
  label: string,
) => {
  const client = useGitHubClient()
  const { register } = useActionActivityRegistry()

  const { trigger, phase, run, error } = useGitHubOperation<
    Record<string, string>
  >({
    // Dispatch-only: no storage key, so nothing is persisted and the run query
    // stays disabled. The banner owns the run — this hook would otherwise poll
    // the same run a second time, and leave a dispatch record behind that the
    // dialog (which closes as soon as the POST lands) never lives to clear,
    // making the action re-open as "already running" for the next hour.
    storageKey: null,
    queryKey: (sinceRunId) =>
      githubKeys.manualActionRun(org ?? "", workflow, sinceRunId),
    resetKey: `${org ?? ""}:${classroom ?? ""}:${workflow}`,
    dispatch: (inputs) =>
      triggerManualWorkflow(client, org ?? "", workflow, inputs),
    // Never called while tracking is off; the config requires it.
    findRun: () => Promise.resolve(null),
    onDispatched: (result) => {
      if (!org) return
      register({
        org,
        label,
        anchor: { kind: "sinceRunId", workflow, sinceRunId: result.sinceRunId },
      })
    },
  })

  // `failed` can only mean the POST was rejected: with tracking off there is no
  // run to reach a non-success conclusion here.
  return { dispatch: trigger, phase, run, error }
}

export default useTriggerManualAction
