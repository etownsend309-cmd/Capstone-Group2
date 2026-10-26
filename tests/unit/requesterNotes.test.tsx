// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import App from "../../src/App";

afterEach(() => { cleanup(); localStorage.clear(); });

it("unmounts internal notes on switching to Requester and preserves reviewer access", () => {
  localStorage.setItem("clausepilot-agreements-v1", JSON.stringify([{
    id: "privacy-fixture", name: "Synthetic agreement", vendor: "Test vendor",
    submittedAt: "2026-10-01T12:00:00Z", submittedBy: "Prototype user",
    status: "Approved", rawText: "Governing law: Georgia.",
    findings: [{ id: "manual", category: "Governing Law", confidence: 1,
      sourceText: "Governing law: Georgia.", decision: "accepted",
      note: "Added manually by reviewer.", method: "Manual" }],
  }]));
  render(<App />);
  fireEvent.click(within(screen.getByRole("navigation", { name: "Primary navigation" }))
    .getByRole("button", { name: /Review queue/ }));
  expect((screen.getByLabelText("Reviewer note") as HTMLTextAreaElement).value)
    .toBe("Added manually by reviewer.");
  fireEvent.change(screen.getByLabelText("Viewing as"), { target: { value: "Requester" } });
  expect(screen.queryByLabelText("Reviewer note")).toBeNull();
  expect(document.querySelector("textarea")).toBeNull();
  expect(screen.queryByRole("button", { name: "Complete review" })).toBeNull();
  expect(document.body.textContent).not.toContain("Added manually by reviewer.");
  fireEvent.change(screen.getByLabelText("Viewing as"), { target: { value: "Reviewer" } });
  expect((screen.getByLabelText("Reviewer note") as HTMLTextAreaElement).value)
    .toBe("Added manually by reviewer.");
});
