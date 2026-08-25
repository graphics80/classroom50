import { queryOptions, useQuery } from "@tanstack/react-query"

import { useGitHubClient } from "@/context/github/GitHubProvider"
import { tolerateGitHubError } from "@/github-core/errors"
import { githubKeys, rawFileQuery } from "@/github-core/queries"
import {
  parseWorkflowDispatchSpec,
  type WorkflowDispatchSpec,
} from "@/domain/actions/workflowInputs"
import { CONFIG_REPO } from "@/util/configRepo"

// Stable reference, so react-query's select memo holds and the workflow YAML is
// not re-parsed on every keystroke in the run dialog.
const selectSpec = (raw: string): WorkflowDispatchSpec =>
  parseWorkflowDispatchSpec(raw)

/**
 * A workflow file's own `workflow_dispatch` spec — the source of truth for the
 * input types a declaration deliberately does not carry.
 *
 * A missing file yields `inputs: null` ("not dispatchable"), so a declaration
 * naming a workflow that has since been deleted disables its action instead of
 * dispatching into a 404.
 */
const useWorkflowDispatchSpec = (org: string, workflow: string) => {
  const client = useGitHubClient()
  const path = `.github/workflows/${workflow}`
  const base = rawFileQuery(client, org, CONFIG_REPO, path)

  return useQuery(
    queryOptions({
      ...base,
      queryKey: githubKeys.rawFile(org, CONFIG_REPO, path),
      // rawFileQuery always supplies a queryFn; the non-null assertion is for
      // the option type, which allows it to be absent.
      queryFn: (context) =>
        tolerateGitHubError(
          () => base.queryFn!(context) as Promise<string>,
          "",
        ),
      enabled: Boolean(org && workflow),
      select: selectSpec,
    }),
  )
}

export default useWorkflowDispatchSpec
