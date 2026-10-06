/** Display formatting helpers. Pure functions, so they are easy to unit test. */

import type { ExtractionStatus } from "../pdf/types";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "n/a";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US");
}

export function formatPageList(pages: number[]): string {
  if (pages.length === 0) return "none";
  if (pages.length <= 8) return pages.join(", ");
  return `${pages.slice(0, 8).join(", ")} (+${pages.length - 8} more)`;
}

const STATUS_LABELS: Record<ExtractionStatus, string> = {
  success: "Success",
  warning: "Warning",
  failed: "Failed",
};

export function statusLabel(status: ExtractionStatus): string {
  return STATUS_LABELS[status] ?? "Unknown";
}
