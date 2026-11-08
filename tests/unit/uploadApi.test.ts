import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "../../src/lib/api";

// Stub fetch entirely: these tests never contact a Function or storage service.
afterEach(() => vi.unstubAllGlobals());
const pdf = () => new File(["%PDF-1.7"], "agreement.pdf", { type: "application/pdf" });

describe("KAN-41 upload API error handling", () => {
  it.each([
    [400, "That file isn't a valid PDF."],
    [403, "Attachment not permitted."],
    [500, "Upload unavailable."],
  ])("preserves the backend error for HTTP %i", async (status, message) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: message }, { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.uploadDocument("agreement-id", pdf())).rejects.toMatchObject({
      name: "ApiRequestError", status, message,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a non-JSON platform rejection and allows an explicit retry with the same file and agreement", async () => {
    const record = { id: "document-id", fileName: "agreement.pdf" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("<html>Payload too large</html>", { status: 413 }))
      .mockResolvedValueOnce(Response.json(record, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const file = pdf();
    await expect(api.uploadDocument("agreement-id", file)).rejects.toMatchObject({
      status: 413, message: "The request failed (413).",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // No automatic retry.
    await expect(api.uploadDocument("agreement-id", file)).resolves.toEqual(record);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [path, init] of fetchMock.mock.calls) {
      expect(path).toBe("/api/agreements/agreement-id/documents");
      expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
      expect(init.body).toBeInstanceOf(FormData);
      expect(init.body.get("file").name).toBe(file.name);
      expect(init.body.get("file").size).toBe(file.size);
    }
    // This is client-level retry capability; App currently offers no retry UI.
  });

  it("turns a network rejection into actionable feedback without automatically retrying", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const failure = api.uploadDocument("agreement-id", pdf());
    await expect(failure).rejects.toBeInstanceOf(ApiRequestError);
    await expect(failure).rejects.toMatchObject({
      status: 0, message: "Couldn't reach ClausePilot. Check your connection and try again.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
