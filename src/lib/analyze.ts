import type { ApprovedCategory } from "../shared/classifier";
import type { Finding, FindingSeverity } from "../types";

export interface PlaybookCategory {
  name: ApprovedCategory;
  patterns: RegExp[];
  confidence: number;

  expectation: string;
  severity: FindingSeverity;
  uncertainPatterns: RegExp[];
  standardPatterns?: RegExp[];
}

export const playbook: PlaybookCategory[] = [
  {
    name: "Governing Law",
    patterns: [/governed by the laws? of/i, /governing law/i],
    confidence: 0.98,
    expectation: "The agreement identifies its governing law and jurisdiction.",
    severity: "Medium",
    uncertainPatterns: [/\b(?:law|laws|jurisdiction|governing)\b/i],
  },
  {
    name: "Anti-Assignment",
    patterns: [/anti[- ]assignment/i, /(?:may|shall) not assign/i, /assignment.{0,120}(?:prior written )?consent/i],
    confidence: 0.93,
    expectation: "The agreement addresses assignment rights and restrictions.",
    severity: "Medium",
    uncertainPatterns: [/\bassign(?:ment|ed)?\b/i],
  },
  {
    name: "Cap On Liability",
    patterns: [/cap on liability/i, /limitation of liability/i, /aggregate liability.{0,120}(?:shall not exceed|limited to)/i],
    confidence: 0.96,
    expectation: "The agreement addresses limits on liability.",
    severity: "Medium",
    uncertainPatterns: [/\bliabilit(?:y|ies)\b|\blimit(?:ation|ed|s)\b/i],

  },
  {
    name: "Audit Rights",
    patterns: [/audit rights?/i, /books and records.{0,120}inspect/i, /right to audit/i],
    confidence: 0.9,
    expectation: "The agreement addresses audit or inspection rights.",
    severity: "Medium",
    uncertainPatterns: [/\baudit\b|\binspect(?:ion)?\b|\bbooks and records\b/i],
  },
  {
    name: "Termination For Convenience",
    patterns: [/termination for convenience/i, /terminate.{0,80}for any reason/i],
    confidence: 0.93,
    expectation: "The agreement addresses termination for convenience.",
    severity: "Medium",
    uncertainPatterns: [/\bterminat(?:e|ion|ed|ing)\b/i],
  },
  {
    name: "Exclusivity",
    patterns: [/exclusivity/i, /exclusive (?:supplier|provider|distributor|relationship|right)/i, /sole and exclusive/i],
    confidence: 0.9,
    expectation: "The agreement addresses any exclusivity commitment.",
    severity: "Medium",
    uncertainPatterns: [/\bexclusiv(?:e|ity)\b|\bsole\b/i],
  },
  {
    name: "Renewal Term",
    patterns: [/renewal term/i, /automatically renew/i, /successive renewal/i, /auto[- ]?renew/i],
    confidence: 0.95,
    expectation: "The agreement addresses renewal terms and whether renewal is automatic.",
    severity: "Medium",
    uncertainPatterns: [/\brenew(?:al|s|ed)?\b|\bautomatic(?:ally)?\b/i],
  },
  {
    name: "Insurance",
    patterns: [/insurance coverage/i, /commercial general liability/i, /certificate of insurance/i],
    confidence: 0.92,
    expectation: "The agreement addresses applicable insurance coverage.",
    severity: "Medium",
    uncertainPatterns: [/\binsur(?:ance|er)\b|\bcoverage\b/i],
  },
  {
    name: "Change Of Control",
    patterns: [/change of control/i, /merger.{0,120}(?:consent|notice|assignment)/i, /transfer of substantially all assets/i],
    confidence: 0.91,
    expectation: "The agreement addresses the effect of a change of control.",
    severity: "Medium",
    uncertainPatterns: [/\bchange of control\b|\bmerger\b|\btransfer\b/i],
  },
  {
    name: "Uncapped Liability",
    patterns: [/uncapped liability/i, /unlimited liability/i, /not subject to (?:the )?(?:liability )?cap/i, /liability.{0,100}(?:not limited|without limitation)/i],
    confidence: 0.9,
    expectation: "The agreement identifies any liability that is uncapped or outside a liability cap.",
    severity: "Medium",
    uncertainPatterns: [/\bliabilit(?:y|ies)\b|\bcap\b|\bunlimited\b/i],
  },
  {
    name: "Notice Period To Terminate Renewal",
    patterns: [
      /notice period to terminate renewal/i,
      /renew[\s\S]{0,180}(?:thirty|sixty|ninety|\d+)[\s\S]{0,30}days?[\s\S]{0,60}(?:written )?notice/i,
      /(?:thirty|sixty|ninety|\d+)[\s\S]{0,30}days?[\s\S]{0,60}(?:written )?notice[\s\S]{0,180}renew/i,
    ],
    confidence: 0.89,
    expectation: "The agreement states the notice period for ending or not renewing a renewal term.",
    severity: "Medium",
    uncertainPatterns: [/\brenew(?:al)?\b|\bnotice\b|\bdays?\b/i],
  },
  {
    name: "Warranty Duration",
    patterns: [/warranty period/i, /warrants?.{0,100}(days?|months?|years?)/i],
    confidence: 0.87,
    expectation: "The agreement addresses the duration of applicable warranties.",
    severity: "Medium",
    uncertainPatterns: [/\bwarrant(?:y|ies|s|ed)\b|\bguarantee\b/i],
  },
];

function sourceSpan(text: string, start: number, length: number): string {
  const windowStart = Math.max(0, start - 110);
  const windowEnd = Math.min(text.length, start + length + 170);
  const before = windowStart > 0 ? "…" : "";
  const after = windowEnd < text.length ? "…" : "";
  return `${before}${text.slice(windowStart, windowEnd).trim()}${after}`.replace(/\s+/g, " ");
}

export function analyzeAgreement(
  text: string,
  rules: PlaybookCategory[] = playbook,
): Finding[] {
  if (!text.trim()) return [];

  return rules.flatMap((category): Finding[] => {
    for (const pattern of category.patterns) {
      const match = pattern.exec(text);
      if (match?.index !== undefined) {
        const standardMatches = category.standardPatterns?.some((standard) => {
          const flags = standard.flags.replace("g", "");
          return new RegExp(standard.source, flags).test(text);
        });
        const classification = category.standardPatterns
          ? (standardMatches ? "present" : "deviation")
          : "present";

        return [
          {
            id: crypto.randomUUID(),
            category: category.name,
            confidence: category.confidence,
            sourceText: sourceSpan(text, match.index, match[0].length),
            decision: "pending" as const,
            note: "",
            method: "Local rule" as const,
            confidenceBasis: "prototype-rule" as const,
            findingType: "Provision" as const,
            classification,
            severity: category.severity,
            reason: classification === "deviation"
              ? "A provision is present but does not match the configured playbook standard; review it as a deviation, not an omission."
              : "A provision was identified for this expected category; compare it with the playbook expectation during review.",
            playbookExpectation: category.expectation,
          },
        ];
      }
    }

    for (const pattern of category.uncertainPatterns) {
      const match = pattern.exec(text);
      if (match?.index !== undefined) {
        return [{
          id: crypto.randomUUID(),
          category: category.name,
          confidence: 0.45,
          sourceText: sourceSpan(text, match.index, match[0].length),
          decision: "pending" as const,
          note: "",
          method: "Local rule" as const,
          confidenceBasis: "prototype-rule" as const,
          findingType: "Provision" as const,
          classification: "uncertain" as const,
          severity: category.severity,
          reason: "Related text was found, but it did not match the provision rule reliably enough to call this a gap.",
          playbookExpectation: category.expectation,
        }];
      }
    }

    return [{
      id: crypto.randomUUID(),
      category: category.name,
      confidence: 0.72,
      sourceText: "",
      decision: "pending" as const,
      note: "",
      method: "Local rule" as const,
      confidenceBasis: "prototype-rule" as const,
      findingType: "Gap" as const,
      classification: "gap" as const,
      severity: category.severity,
      reason: `The completed stored agreement text was searched for this expected provision, but no matching provision was identified. This is a possible omission, not proof that the provision is absent.`,
      playbookExpectation: category.expectation,
    }];
  });
}

/** Keep validated AI/manual findings and fill only uncovered categories with transparent local-rule results. */
export function supplementWithLocalAnalysis(text: string, findings: Finding[]): Finding[] {
  const represented = new Set(findings.map((finding) => finding.category));
  return [
    ...findings,
    ...analyzeAgreement(text).filter((finding) => !represented.has(finding.category)),
  ];
}
