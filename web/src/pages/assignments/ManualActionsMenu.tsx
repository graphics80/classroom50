import { ChevronDownIcon, PlayIcon } from "@/components/ui/icons"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui"
import type { ManualAction } from "@/domain/actions/manualActions"
import ManualActionModal from "./ManualActionModal"

// The classroom's declared manual actions, as a dropdown next to the toolbar's
// primary action. Nothing appears here by discovery: an entry exists because
// <classroom>/actions.json named the workflow and the viewer's role clears the
// action's declared minimum.
export function ManualActionsMenu({
  org,
  classroom,
  actions,
}: {
  org: string
  classroom: string
  actions: ManualAction[]
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<ManualAction | null>(null)

  if (actions.length === 0) return null

  return (
    <>
      <div className="dropdown dropdown-end">
        <Button size="sm" tabIndex={0}>
          {t("submissions.menu.actions")}
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </Button>
        <ul
          tabIndex={0}
          role="menu"
          className="dropdown-content menu z-10 mt-1 w-64 rounded-box border border-base-300 bg-base-100 p-1 shadow"
        >
          {actions.map((action) => (
            <li key={action.workflow}>
              <button
                type="button"
                title={action.description}
                onClick={() => {
                  // Close the dropdown before the dialog opens so focus doesn't
                  // fight it (the toolbar's other dropdowns do the same).
                  ;(document.activeElement as HTMLElement | null)?.blur()
                  setOpen(action)
                }}
              >
                <PlayIcon aria-hidden="true" className="size-4" />
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {open ? (
        <ManualActionModal
          org={org}
          classroom={classroom}
          action={open}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  )
}

export default ManualActionsMenu
