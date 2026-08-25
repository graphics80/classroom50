import { useMemo } from "react"
import { queryOptions, useQuery } from "@tanstack/react-query"

import type { GitHubClient } from "@/github-core/client"
import { useGitHubClient } from "@/context/github/GitHubProvider"
import { tolerateGitHubError } from "@/github-core/errors"
import { githubKeys, rawFileQuery } from "@/github-core/queries"
import {
  ACTIONS_FILE,
  parseActionsFile,
  roleMeetsMinimum,
  type ManualAction,
} from "@/domain/actions/manualActions"
import type { ResolvedRole } from "@/authz"
import { CONFIG_REPO } from "@/util/configRepo"

// Module-level so the reference is stable: react-query only reuses a cached
// select result while `select` keeps its identity, and an inline closure would
// re-parse the file on every render of the page that holds the search box.
const selectActions = (raw: string): ManualAction[] => {
  try {
    return parseActionsFile(JSON.parse(raw))
  } catch {
    // A hand-edit that broke the JSON reads like an absent file. Degrading is
    // the point: a half-written declaration must not surface an action with a
    // policy the file doesn't actually express.
    return []
  }
}

/**
 * The manual actions a classroom declared (`<classroom>/actions.json`),
 * filtered to the ones the viewer's role may run.
 *
 * Most classrooms never declare one, so the miss is the common case and is
 * cached as an empty file rather than left as a query error — otherwise every
 * mount of the assignments page would re-issue the same 404.
 *
 * The role filter is UX; GitHub enforces the real boundary through Actions
 * write on the config repo. But offering a button that is going to 403 is
 * worse than not offering it.
 */
const useManualActions = (
  org: string | undefined,
  classroom: string | undefined,
  role: ResolvedRole | undefined,
) => {
  const client = useGitHubClient()
  const query = useQuery(manualActionsQuery(client, org ?? "", classroom ?? ""))

  return useMemo(
    () =>
      (query.data ?? []).filter((action) =>
        roleMeetsMinimum(role, action.min_role),
      ),
    [query.data, role],
  )
}

export function manualActionsQuery(
  client: GitHubClient,
  org: string,
  classroom: string,
) {
  const path = `${classroom}/${ACTIONS_FILE}`
  const base = rawFileQuery(client, org, CONFIG_REPO, path)
  return queryOptions({
    ...base,
    queryKey: githubKeys.rawFile(org, CONFIG_REPO, path),
    // rawFileQuery always supplies a queryFn; the non-null assertion is for the
    // option type, which allows it to be absent.
    queryFn: (context) =>
      tolerateGitHubError(
        () => base.queryFn!(context) as Promise<string>,
        // An absent file is data, not a failure: cached like any read, so it
        // honors staleTime instead of refetching on every mount.
        "[]",
      ),
    enabled: Boolean(org && classroom),
    select: selectActions,
  })
}

export default useManualActions
