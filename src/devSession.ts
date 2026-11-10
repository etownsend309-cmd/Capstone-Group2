import type { SessionUser } from "./shared/api";

/**
 * The account used when local `vite` is started with VITE_LOCAL_BYPASS=1.
 * It exists only so the review screens can be opened on a machine that has
 * no Netlify Identity service. Production builds never read this.
 */
export const localTestUser: SessionUser = {
  id: "00000000-0000-4000-8000-0000000000a1",
  email: "local-reviewer@example.test",
  displayName: "Local reviewer",
  roles: ["requester", "reviewer", "administrator"],
  permissions: ["approve"],
};
