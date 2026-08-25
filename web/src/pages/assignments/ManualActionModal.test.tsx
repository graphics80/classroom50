// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

import type { ManualAction } from "@/domain/actions/manualActions"
import type { WorkflowDispatchSpec } from "@/domain/actions/workflowInputs"

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>()
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) }
})

vi.mock("@/context/github/GitHubProvider", () => ({
  useGitHubClient: () => ({}),
}))

let spec: WorkflowDispatchSpec = { inputs: [] }
vi.mock("@/hooks/useWorkflowDispatchSpec", () => ({
  default: () => ({ data: spec, isLoading: false }),
}))

const dispatch = vi.fn()
let phase = "idle"
let dispatchError: unknown = null
vi.mock("@/hooks/useTriggerManualAction", () => ({
  default: () => ({
    dispatch,
    phase,
    run: null,
    error: dispatchError,
  }),
}))

import { ManualActionModal } from "./ManualActionModal"

const action = (over: Partial<ManualAction> = {}): ManualAction => ({
  workflow: "moodle-sync.yaml",
  label: "Moodle-Sync",
  min_role: "teacher",
  inputs: {},
  ...over,
})

const wrap = (ui: ReactNode) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const show = (a: ManualAction) =>
  wrap(
    <ManualActionModal
      org="acme"
      classroom="m323-ix24"
      action={a}
      onClose={() => {}}
    />,
  )

const runButton = () =>
  screen.getByRole("button", { name: "assignments.manualActions.run" })

beforeEach(() => {
  dispatch.mockReset()
  spec = { inputs: [] }
  phase = "idle"
  dispatchError = null
})

afterEach(cleanup)

describe("ManualActionModal", () => {
  it("sends a locked value the form never offered", async () => {
    spec = {
      inputs: [
        { name: "classroom", type: "string", required: false },
        { name: "user", type: "string", required: false },
      ],
    }
    show(
      action({
        inputs: { classroom: { policy: "locked", value: "{{classroom}}" } },
      }),
    )

    // The Run button exists while the spec is still loading, so wait for the
    // resolved scope line before acting.
    await screen.findByText("m323-ix24")
    fireEvent.click(runButton())

    // classroom is fixed by the declaration; `user` was never declared, so it
    // is neither shown nor sent — a blank scope input must not travel.
    expect(dispatch).toHaveBeenCalledWith({ classroom: "m323-ix24" })
    expect(screen.queryByLabelText("user")).toBeNull()
  })

  it("shows a locked value so the scope is readable before running", async () => {
    spec = { inputs: [{ name: "classroom", type: "string", required: false }] }
    show(
      action({
        inputs: { classroom: { policy: "locked", value: "{{classroom}}" } },
      }),
    )

    expect(await screen.findByText("m323-ix24")).toBeTruthy()
    // Shown, but with no control to change it.
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("sends what the teacher typed into a shown field", async () => {
    spec = { inputs: [{ name: "assignment", type: "string", required: false }] }
    show(action({ inputs: { assignment: { policy: "shown" } } }))

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "serie-03" },
    })
    fireEvent.click(runButton())

    expect(dispatch).toHaveBeenCalledWith({ assignment: "serie-03" })
  })

  it("starts a boolean from the declaration's default and sends its string form", async () => {
    spec = {
      inputs: [
        { name: "dry_run", type: "boolean", required: false, default: "false" },
      ],
    }
    show(action({ inputs: { dry_run: { policy: "shown", value: "true" } } }))

    const checkbox = (await screen.findByRole("checkbox")) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(runButton())
    expect(dispatch).toHaveBeenCalledWith({ dry_run: "true" })
  })

  it("refuses to run a declaration that can't produce a valid dispatch", async () => {
    spec = { inputs: [{ name: "target", type: "string", required: true }] }
    show(action())

    expect(
      await screen.findByText("assignments.manualActions.needsConfiguration"),
    ).toBeTruthy()
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it("refuses to run a workflow with no manual trigger", async () => {
    spec = { inputs: null }
    show(action())

    expect(
      await screen.findByText("assignments.manualActions.notDispatchable"),
    ).toBeTruthy()
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
  })

  // Registration with the Actions banner rides the dispatch's success, so a
  // POST that never lands has no other surface than this dialog.
  it("keeps the dialog open and names the reason when the dispatch is rejected", async () => {
    phase = "failed"
    dispatchError = new Error(
      "Resource not accessible by personal access token",
    )
    show(action())

    expect(
      await screen.findByText("assignments.manualActions.dispatchFailed"),
    ).toBeTruthy()
  })

  it("closes once the run is tracked", async () => {
    phase = "running"
    const onClose = vi.fn()
    wrap(
      <ManualActionModal
        org="acme"
        classroom="m323-ix24"
        action={action()}
        onClose={onClose}
      />,
    )

    expect(onClose).toHaveBeenCalled()
  })

  it.each([
    [
      "an input the workflow doesn't have",
      { classrom: { policy: "locked" as const, value: "x" } },
      "assignments.manualActions.unknownInput",
    ],
    [
      "a locked input with no value",
      { classroom: { policy: "locked" as const } },
      "assignments.manualActions.lockedWithoutValue",
    ],
  ])("refuses to run a declaration with %s", async (_case, inputs, message) => {
    spec = { inputs: [{ name: "classroom", type: "string", required: false }] }
    show(action({ inputs }))

    expect(await screen.findByText(message)).toBeTruthy()
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
  })
})
