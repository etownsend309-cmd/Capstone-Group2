// Builds ai-classifier-evaluation-chart.svg from the numbers in ai-classifier-evaluation.md.
import { writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);

const data = [
  ["Renewal Term", 100.0],
  ["Governing Law", 98.2],
  ["Anti-Assignment", 97.6],
  ["Notice Period To Terminate Renewal", 93.3],
  ["Exclusivity", 88.9],
  ["Insurance", 88.9],
  ["Audit Rights", 87.5],
  ["Change Of Control", 80.0],
  ["Termination For Convenience", 77.8],
  ["Cap On Liability", 76.9],
  ["Uncapped Liability", 70.0],
  ["Warranty Duration", 40.0],
];

const GREEN = "#3b8f6b";
const GOLD = "#f0a82a";
const RED = "#c95b5f";
const DARK = "#3a3a3a";
const colorFor = (v) => (v >= 90 ? GREEN : v >= 75 ? GOLD : RED);
const FONT = `font-family="Helvetica Neue, Helvetica, Arial, sans-serif"`;

const chartX = 910; // left edge of the bar tracks
const trackW = 520;
const cardPad = 556; // left edge of text inside the chart card
const rowTop = 256;
const rowH = 39;

const rows = data
  .map(([name, v], i) => {
    const y = rowTop + i * rowH;
    return `
    <text x="${chartX - 16}" y="${y + 20}" text-anchor="end" font-size="19" fill="#333" ${FONT}>${name}</text>
    <rect x="${chartX}" y="${y}" width="${trackW}" height="26" rx="6" fill="#ececec"/>
    <rect x="${chartX}" y="${y}" width="${(trackW * v) / 100}" height="26" rx="6" fill="${colorFor(v)}"/>
    <text x="${chartX + trackW + 14}" y="${y + 20}" font-size="19" font-weight="700" fill="#222" ${FONT}>${v.toFixed(1)}%</text>`;
  })
  .join("");

const legend = [
  [GREEN, "90%+"],
  [GOLD, "75\u201389%"],
  [RED, "Below 75%"],
]
  .map(
    ([c, label], i) => `
    <rect x="${cardPad + i * 130}" y="216" width="14" height="14" rx="3" fill="${c}"/>
    <text x="${cardPad + i * 130 + 22}" y="228" font-size="16" fill="#555" ${FONT}>${label}</text>`,
  )
  .join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="115%">
      <feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="#000" flood-opacity="0.12"/>
    </filter>
  </defs>
  <rect width="1600" height="900" fill="#f4f4f4"/>

  <text x="64" y="84" font-size="44" font-weight="700" fill="#222" ${FONT}>AI classifier results: how well it finds the 12 categories</text>
  <text x="64" y="124" font-size="22" fill="#555" ${FONT}>Tested on 30 contracts from the CUAD dataset  \u00b7  gpt-5.6-terra  \u00b7  0 failed runs</text>

  <!-- KPI cards -->
  <rect x="64" y="160" width="440" height="170" rx="16" fill="#fff" filter="url(#shadow)"/>
  <text x="92" y="200" font-size="20" fill="#666" ${FONT}>Macro F1</text>
  <text x="92" y="268" font-size="64" font-weight="700" fill="${DARK}" ${FONT}>83.3%</text>
  <text x="92" y="304" font-size="17" fill="#777" ${FONT}>Precision 83.1%  \u00b7  Recall 84.3%</text>

  <rect x="64" y="350" width="440" height="170" rx="16" fill="#fff" filter="url(#shadow)"/>
  <text x="92" y="390" font-size="20" fill="#666" ${FONT}>Quotes that matched the source exactly</text>
  <text x="92" y="458" font-size="64" font-weight="700" fill="${GREEN}" ${FONT}>96.1%</text>
  <text x="92" y="494" font-size="17" fill="#777" ${FONT}>The rest are rejected and never shown</text>

  <rect x="64" y="540" width="440" height="190" rx="16" fill="#fff" filter="url(#shadow)"/>
  <text x="92" y="580" font-size="20" fill="#666" ${FONT}>Weakest categories</text>
  <text x="92" y="632" font-size="34" font-weight="700" fill="${RED}" ${FONT}>Warranty Duration</text>
  <text x="92" y="674" font-size="34" font-weight="700" fill="${RED}" ${FONT}>Uncapped Liability</text>
  <text x="92" y="710" font-size="17" fill="#777" ${FONT}>Why a human reviews every flag</text>

  <!-- Chart card -->
  <rect x="528" y="160" width="1008" height="570" rx="16" fill="#fff" filter="url(#shadow)"/>
  <text x="${cardPad}" y="200" font-size="24" font-weight="600" fill="#222" ${FONT}>F1 score by category</text>
  ${legend}
  ${rows}

  <!-- Takeaway banner -->
  <rect x="64" y="752" width="1472" height="76" rx="10" fill="#3b3b3b"/>
  <text x="90" y="797" font-size="21" fill="#fff" ${FONT}><tspan font-weight="700" fill="${GOLD}">Takeaway:</tspan> strong on clear-cut clauses, weaker on nuanced ones. Local rules fill any category the model skips, and a reviewer decides every flag.</text>

  <text x="64" y="866" font-size="15" fill="#777" ${FONT}>CUAD is the development set, so these results are not independent holdout evidence. Source: artifacts/ai-classifier-evaluation.md</text>
</svg>
`;

writeFileSync(path.join(dir, "ai-classifier-evaluation-chart.svg"), svg);
console.log("wrote ai-classifier-evaluation-chart.svg");
