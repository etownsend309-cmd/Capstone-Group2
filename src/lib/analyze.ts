import type { Finding } from "../types";

export interface PlaybookCategory {
  name: string;
  patterns: RegExp[];
  confidence: number;
}

export const playbook: PlaybookCategory[] = [
  {
    name: "Governing Law",
    patterns: [/governed by the laws? of/i, /governing law/i],
    confidence: 0.98,
  },
  {
    name: "Anti-Assignment",
    patterns: [/anti[- ]assignment/i, /(?:may|shall) not assign/i, /assignment.{0,120}(?:prior written )?consent/i],
    confidence: 0.93,
  },
  {
    name: "Cap On Liability",
    patterns: [/cap on liability/i, /limitation of liability/i, /aggregate liability.{0,120}(?:shall not exceed|limited to)/i],
    confidence: 0.96,
  },
  {
    name: "Audit Rights",
    patterns: [/audit rights?/i, /books and records.{0,120}inspect/i, /right to audit/i],
    confidence: 0.9,
  },
  {
    name: "Termination For Convenience",
    patterns: [/termination for convenience/i, /terminate.{0,80}for any reason/i],
    confidence: 0.93,
  },
  {
    name: "Exclusivity",
    patterns: [/exclusivity/i, /exclusive (?:supplier|provider|distributor|relationship|right)/i, /sole and exclusive/i],
    confidence: 0.9,
  },
  {
    name: "Renewal Term",
    patterns: [/renewal term/i, /automatically renew/i, /successive renewal/i, /auto[- ]?renew/i],
    confidence: 0.95,
  },
  {
    name: "Insurance",
    patterns: [/insurance coverage/i, /commercial general liability/i, /certificate of insurance/i],
    confidence: 0.92,
  },
  {
    name: "Change Of Control",
    patterns: [/change of control/i, /merger.{0,120}(?:consent|notice|assignment)/i, /transfer of substantially all assets/i],
    confidence: 0.91,
  },
  {
    name: "Uncapped Liability",
    patterns: [/uncapped liability/i, /unlimited liability/i, /not subject to (?:the )?(?:liability )?cap/i, /liability.{0,100}(?:not limited|without limitation)/i],
    confidence: 0.9,
  },
  {
    name: "Notice Period To Terminate Renewal",
    patterns: [
      /notice period to terminate renewal/i,
      /renew[\s\S]{0,180}(?:thirty|sixty|ninety|\d+)[\s\S]{0,30}days?[\s\S]{0,60}(?:written )?notice/i,
      /(?:thirty|sixty|ninety|\d+)[\s\S]{0,30}days?[\s\S]{0,60}(?:written )?notice[\s\S]{0,180}renew/i,
    ],
    confidence: 0.89,
  },
  {
    name: "Warranty Duration",
    patterns: [/warranty period/i, /warrants?.{0,100}(days?|months?|years?)/i],
    confidence: 0.87,
  },
];

function sourceSpan(text: string, start: number, length: number): string {
  const windowStart = Math.max(0, start - 110);
  const windowEnd = Math.min(text.length, start + length + 170);
  const before = windowStart > 0 ? "…" : "";
  const after = windowEnd < text.length ? "…" : "";
  return `${before}${text.slice(windowStart, windowEnd).trim()}${after}`.replace(/\s+/g, " ");
}

export function analyzeAgreement(text: string): Finding[] {
  return playbook.flatMap((category) => {
    for (const pattern of category.patterns) {
      const match = pattern.exec(text);
      if (match?.index !== undefined) {
        return [
          {
            id: crypto.randomUUID(),
            category: category.name,
            confidence: category.confidence,
            sourceText: sourceSpan(text, match.index, match[0].length),
            decision: "pending" as const,
            note: "",
            method: "Local rule" as const,
          },
        ];
      }
    }
    return [];
  });
}
