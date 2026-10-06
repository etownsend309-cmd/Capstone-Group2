/**
 * @vitest-environment jsdom
 *
 * Intake tests for the review app, covering the drag-and-drop path.
 *
 * Regression context: the intake "drop zone" was originally a click-only
 * button with no drag handlers, so dropping a PDF on it fell through to the
 * window and the browser navigated to the file, replacing the app with its own
 * PDF viewer.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import App from "../../src/App";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

const txtFile = (name = "northstar-msa.txt") =>
  new File(["GOVERNING LAW. Governed by the laws of Georgia."], name, { type: "text/plain" });

/** Move to the intake view and hand back its drop zone. */
async function openIntake(): Promise<HTMLElement> {
  render(<App />);
  // Scoped to the sidebar: the overview hero offers a "New agreement" button too.
  const nav = screen.getByRole("navigation", { name: /primary navigation/i });
  await userEvent.click(within(nav).getByRole("button", { name: /new agreement/i }));
  return screen.getByRole("button", { name: /drop an agreement here/i });
}

describe("agreement intake", () => {
  it("accepts a dropped file and cancels the browser's own navigation", async () => {
    const dropZone = await openIntake();
    const file = txtFile();

    // `fireEvent.drop` reports whether any handler called preventDefault.
    // Without that, the browser opens the file instead of the app handling it.
    const notCancelled = fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    expect(notCancelled).toBe(false);
    expect(screen.getByText(file.name)).toBeTruthy();
  });

  it("cancels the default on dragover so the drop target stays active", async () => {
    const dropZone = await openIntake();

    const notCancelled = fireEvent.dragOver(dropZone, { dataTransfer: { files: [] } });

    expect(notCancelled).toBe(false);
  });

  it("uses the dropped filename as the default agreement title", async () => {
    const dropZone = await openIntake();

    fireEvent.drop(dropZone, { dataTransfer: { files: [txtFile("vendor-sow.txt")] } });

    const title = screen.getByPlaceholderText(/Northstar MSA/i) as HTMLInputElement;
    expect(title.value).toBe("vendor-sow.txt");
  });

  it("extracts a dropped text agreement and opens it for review", async () => {
    const dropZone = await openIntake();

    fireEvent.drop(dropZone, { dataTransfer: { files: [txtFile()] } });
    await userEvent.click(screen.getByRole("button", { name: /create review/i }));

    // Governing Law is one of the 12 approved categories and matches this text.
    // Match the detail heading specifically: the category name also appears in
    // the findings list and in the manual-add dropdown.
    expect(
      await screen.findByRole("heading", { level: 3, name: "Governing Law" }),
    ).toBeTruthy();
    expect(screen.getByText(/Governed by the laws of Georgia/i)).toBeTruthy();
  });
});
