/**
 * @vitest-environment jsdom
 *
 * Which screen the identity gate shows once the session has resolved.
 *
 * The cases that matter are the ones where a user exists but the app is still
 * the wrong thing to render: a recovery link signs the user in before the
 * password is chosen, and an invitation can be opened in a browser that
 * already holds a session. Handing either of them the app strands the link,
 * because `handleAuthCallback` clears its token from the address bar as it
 * reads it, leaving the token in React state only.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthGate } from "../../src/components/AuthGate";

vi.mock("@netlify/identity", () => ({
  acceptInvite: vi.fn(),
  getUser: vi.fn(),
  handleAuthCallback: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  onAuthChange: vi.fn(() => () => {}),
  requestPasswordRecovery: vi.fn(),
  updateUser: vi.fn(),
}));

const { getUser, handleAuthCallback } = await import("@netlify/identity");

/** A session that already exists in this browser, unrelated to any link. */
const existingUser = { id: "existing-user-id", email: "already@example.test" };

const renderGate = () => render(<AuthGate>{(user) => <p>Workspace for {user.email}</p>}</AuthGate>);

beforeEach(() => {
  vi.mocked(handleAuthCallback).mockResolvedValue(null);
  vi.mocked(getUser).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("identity gate", () => {
  it("shows the sign-in card when there is no session", async () => {
    renderGate();

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByText(/^Workspace for/)).toBeNull();
  });

  it("shows the app when a session exists and no link was followed", async () => {
    vi.mocked(getUser).mockResolvedValue(existingUser);

    renderGate();

    expect(await screen.findByText(`Workspace for ${existingUser.email}`)).toBeTruthy();
  });

  it.each([
    ["recovery", { type: "recovery" as const, user: existingUser }, "Choose a new password"],
    ["invitation", { type: "invite" as const, user: null, token: "invite-token" }, "Set your password"],
  ])("holds a signed-in user on the password card after %s", async (_kind, callback, heading) => {
    vi.mocked(handleAuthCallback).mockResolvedValue(callback);
    // The invitation case is the regression: the link carries no session of
    // its own, but one already in the browser is enough to satisfy `getUser`.
    vi.mocked(getUser).mockResolvedValue(existingUser);

    renderGate();

    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.queryByText(/^Workspace for/)).toBeNull();
  });
});
