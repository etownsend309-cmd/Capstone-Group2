/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ConfidenceNote } from "../../src/components/ConfidenceNote";
import type { CalibrationRecord } from "../../src/shared/calibration";

const record: CalibrationRecord = {
  model: "gpt-5.6-terra",
  promptVersion: "clausepilot-classifier-v1",
  schemaVersion: "classifier-output-v1",
  ratings: {
    high: { correct: 45, total: 50 },
    medium: { correct: 10, total: 20 },
    low: { correct: 0, total: 0 },
  },
};

const run = {
  requestedModel: "gpt-5.6-terra",
  promptVersion: "clausepilot-classifier-v1",
  schemaVersion: "classifier-output-v1",
};

afterEach(() => cleanup());

describe("confidence note", () => {
  it("shows the measured count for a matching run", async () => {
    render(<ConfidenceNote category="Governing Law" indicator="high" run={run} record={record} />);
    await userEvent.click(screen.getByRole("button", { name: "About the Governing Law confidence rating" }));

    expect(screen.getByText("high model confidence · calibrated")).toBeTruthy();
    expect(screen.getByText(/high was right 45 of 50 times/)).toBeTruthy();
    expect(screen.getByText("Low means the model saw a weak but possibly relevant match. The checked contracts did not include this rating.")).toBeTruthy();
    expect(screen.getByText("Checked with gpt-5.6-terra and prompt clausepilot-classifier-v1.")).toBeTruthy();
  });

  it("shrinks the note when the button or the page outside it is clicked", async () => {
    render(<ConfidenceNote category="Governing Law" indicator="high" run={run} record={record} />);
    const button = screen.getByRole("button", { name: "About the Governing Law confidence rating" });
    await userEvent.click(button);
    await userEvent.click(button);

    expect(screen.getByRole("note").className).toContain("is-closing");
    await waitFor(() => expect(screen.queryByRole("note")).toBeNull(), { timeout: 1000 });

    await userEvent.click(button);
    await userEvent.click(document.body);
    expect(screen.getByRole("note").className).toContain("is-closing");
  });
});
