# Vendor Agreement Review Assistant

*MIST 7590E, MSBAI Capstone Project*
*Group project repository*

---

## What This Is

The Vendor Agreement Review Assistant helps Calder Industrial Supply triage the ~200 vendor agreements it signs every year:

1. A Requester submits an agreement
2. The system extracts and segments the contract text
3. An identification step (manual first, AI-assisted later) flags which playbook provisions are present
4. A Reviewer works the flags, one by one, with every flag traceable to its exact source text
5. An Approver disposes of anything escalated
6. Procurement can answer how many agreements are in review, how long they've been waiting, and which provisions come up most often across submitted agreements

Built as a course capstone, with secure OpenAI-based identification running behind a Netlify serverless function. A **manual identification screen**  is a required fallback for when that function goes down.

## The Problem We're Solving

Legal sees maybe 40 of Calder's 200 annual vendor agreements. The other 160 get signed by a regional manager who scrolled to the signature block. That gap has already cost them: three business units signed agreements with uncapped indemnification, and an auto-renewal notice window was missed by 11 days before anyone caught it.

The ask isn't an attorney replacement, it's a reliable first pass that tells the team *which* agreements need an attorney's eyes, and *why*, with a receipt (exact source text) behind every flag. 

## Where to Find It

**Production URL:** _(add once deployed, e.g. `https://your-app-name.netlify.app`)_

Once live, the app should be reachable at a public Netlify URL with a seeded, working account for all four roles.

## Where Things Stand

| Item | Status |
|------|:---:|
| Project brief reviewed, scope confirmed | Done |
| Change Notice 1 (CR-01) incorporated, narrowed to presence identification | Done |
| Requirements List finalized (roles, permissions, workflow) | Done |
| Tech stack selected | Done |
| Self-approval permission | Split, needs a team decision |
| React app + RBAC + form validation | Not started |
| PDF ingestion (PDF.js) | Not started |
| Netlify function, OpenAI provision identification | Not started |
| Manual identification fallback screen | Not started |
| Review queue (accept / dismiss / escalate) | Not started |
| Escalation queue (Approver) | Not started |
| Audit record / durable review history | Not started |
| Reporting dashboard | Not started |
| Section 6 verification (check set, precision/recall, threshold note) | Not started |
| Live Netlify deployment | Not started |
| Env vars set in Netlify | Not started |
| Live URL added to this README | Not started |

## Who Uses This, and Capabilities

| Role | Who | Core Capabilities |
|---|---|---|
| **Requester** | Regional manager, dept head | Submit an agreement, track it, see disposition + conditions only |
| **Reviewer** | Procurement analyst / attorney | Work the queue, accept / dismiss / escalate flags with a reason, complete reviews |
| **Approver** | Associate General Counsel *(a permission, not a hard-coded 5th account)* | Everything a Reviewer can, plus final say on escalations |
| **Administrator** | Procurement systems owner | Manage playbook, users, thresholds, reporting |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React (functional + hooks) + TypeScript |
| Build tool | Vite |
| Hosting | Netlify |
| Backend API | Netlify Functions (Node.js + TypeScript) |
| Background processing | Netlify Background Functions |
| Authentication | Netlify Identity |
| Authorization | DB-stored roles + server-side checks |
| Database | Netlify DB (Postgres) *or* Amazon RDS (MySQL) |
| Document storage | Netlify Blobs *or* Amazon S3 |
| PDF processing | PDF.js |
| AI provider | OpenAI Responses API (structured output) |
| Manual AI fallback | Manual identification screen |
| Dashboard/charts | Recharts *(optional, deferred)* |
| Source control | GitHub |
| Testing | Vitest + Playwright |

## What's in the Baseline Build

- Intake form, vendor, agreement type, business unit, needed-by date, document upload
- RBAC across all four roles, enforced **server-side**, not just hidden in the UI
- PDF text extraction + segmentation (PDF.js), text stored by page for exact source-span linking
- Secure provision identification via `/.netlify/functions/identify-provisions`, returns category, source span, confidence
- **Manual identification fallback** if the serverless function is down, see [Why the Manual Path Matters](#why-the-manual-path-matters)
- Review queue: accept / dismiss / escalate, each with a required reason
- Low-confidence flags shown inline with a warning, never suppressed, never siloed
- Escalations route to a dedicated Approver queue, status `escalated`
- **Gating**, can't clear an agreement mid-review
- **No reopening**, a revised agreement is a new, linked request with its own cycle
- Durable, attributable audit trail on every decision
- Reporting dashboard: agreements in review, wait times, most frequent provisions
- Deployed at a public URL, seeded, one working account per role

### Why the Manual Path Matters

Per the brief's "architectural test": pull the AI service out entirely and a legitimate app should remain (intake, queue, review, record, reporting) with a human doing identification instead. Building the manual screen *first* (not as a fallback bolted on later) is what makes that test pass.

## How We're Building It

Application first. Model second. Sponsor's guidance, and it's guidance:

1. Build the whole app with a human doing identification by hand, a screen where a Reviewer marks present provisions and pastes supporting text
2. Get intake → segmentation → flags → queue → disposition → audit → reporting → roles → deployment all working with **zero AI**
3. Swap the manual step for the OpenAI-backed Netlify function
4. **Keep the manual path.** 

This order also means the manual screen *defines* the contract the model has to satisfy, you discover the real interface instead of guessing it.

## How the Pieces Fit Together

```
App
├── AuthGate
├── RequesterView
│   ├── IntakeForm
│   └── MySubmissions
├── ReviewerView
│   ├── ReviewQueue
│   │   └── AgreementDetail
│   │       └── FlagList
│   └── EscalationQueue        
├── AdminView
│   ├── PlaybookManager
│   └── UserManager
└── Dashboard                 
    ├── LoadingMessage
    └── ErrorMessage
```

### Where Everything Is Stored

```
src/
  main.jsx
  App.jsx
  components/
    IntakeForm.jsx
    ReviewQueue.jsx
    AgreementDetail.jsx
    FlagList.jsx
    EscalationQueue.jsx
    PlaybookManager.jsx
    UserManager.jsx
    Dashboard.jsx
    RoleGate.jsx
    LoadingMessage.jsx
    ErrorMessage.jsx
  services/
    agreementService.js
    identificationService.js
    authService.js
  data/
    playbookCategories.js
  styles.css
netlify/
  functions/
    identify-provisions.js
    agreements.js
    reviews.js
    users.js
netlify.toml
```

## How It Talks to OpenAI

### The Netlify function in the middle

The browser never talks to OpenAI directly. It sends extracted contract text to:

```
/.netlify/functions/identify-provisions
```

which:

1. Reads `OPENAI_API_KEY` server-side only
2. Sends segmented text + the playbook category list to OpenAI's Responses API with structured output
3. Returns, per category found: provision category · source text span · confidence indicator

If that call fails, `identificationService.js` drops straight into the manual identification screen, same workflow, human in the loop instead of a model.

### PDF.js, doing the reading

Extracts text + page metadata from uploads and renders the original PDF for reviewers. Storing text by page is what lets every flag point back to an exact span.

## Getting It Running on Your Machine

### What you'll need

- Node.js **TBD+** 

### Frontend Run Commands

```bash
git clone <repo-url>
cd vendor-agreement-review-assistant
npm install
npm run dev
```

Opens at `http://localhost:TBD`. Runs on the **manual identification fallback** since no function server is up.

### With Netlify Functions running *(best for testing AI)*

```bash
cp .env.example .env
```

```bash
OPENAI_API_KEY=sk-your-key-here
DATABASE_URL=your-connection-string
```

Never commit `.env`, `.env.example` is a template only.

```bash
npm run dev:netlify
```

Opens at `http://localhost:TBD`.

### Commands Needed to Run

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite only (manual fallback) |
| `npm run dev:netlify` | Vite + Netlify functions |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | Lint |
| `npm run test` | Vitest, unit / API |
| `npm run test:e2e` | Playwright, end-to-end |

### A Sample Run-Through

- Vendor: `Vendor Name`
- Agreement type: `Type of Agreement`
- Business unit: `Unit Name`
- Needed-by date: any future date
- Document: any sample PDF from the CUAD corpus

## Deploying It to Netlify

- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **Functions directory:** `netlify/functions`
- **Node version:** TBD

On each push: Netlify builds → publishes `dist/` → auto-deploys `netlify/functions/`.

### Environment variables 

| Variable | Scope | Description |
|----------|-------|-------------|
| `OPENAI_API_KEY` | Server-side only | Used by `identify-provisions` |
| `DATABASE_URL` | Server-side only | Netlify DB / RDS connection |

Never prefix a secret with `VITE_`, that ships it straight to the browser.

## Keeping Secrets Safe

- No API keys or secrets in the repo, ever
- `.env` / `.env.local` stay local, already in `.gitignore`
- OpenAI key lives in Netlify env vars (prod) or local `.env` (dev), never in React
- `.env.example` = variable names only, no real values
- **No real personal data, no real proprietary contracts**, CUAD (CC BY 4.0) by design, a hard constraint, not a suggestion
- A committed key gets rotated, and the incident goes in the risk log

## Decisions We've Made (and Ones We Haven't)

Track each with: the question, options considered, decision, reasoning, design consequence.

**Settled**
| Question | Decision |
|---|---|
| Advisory or gating | Gating |
| Requester sees deliberation? | No, disposition + conditions only |
| Reopen a completed review? | No, new linked request, new cycle |
| Where do escalations live? | Dedicated Approver queue, `escalated` |
| Hidden vs. locked-visible UI | Hidden |
| Approver: role or permission? | Permission, grantable to Reviewers |
| Low-confidence handling | Shown in queue, with a warning |

**Still open**
- **Self-approval**, poll came back split; earlier draft said no, now genuinely undecided. Resolve before wiring the approval-permission logic, this touches the audit-integrity guarantee Calder actually asked for.
- Playbook mutability on category change
- One playbook per org, or per agreement type?
- Document retention window after disposition
- Does a dismissal carry forward as a signal, or stay contract-specific?
- Definition of "review complete"
- Others not yet found, that's part of the assignment

## How We Collaborate

```bash
git checkout main
git pull origin main
git checkout -b feature/short-description
```

Small, focused commits → push → open a PR with what/why/how-to-test → **at least one approval** before merging.

### Pull Request Template

```markdown
## Summary
- Brief bullet points of what changed

## Test plan
- [ ] App runs locally with `npm run dev`
- [ ] Netlify function works with `npm run dev:netlify`
- [ ] Role-based access enforced (try each role)
- [ ] Manual fallback works with the AI function disabled
- [ ] AI-identified flags show correct source span + confidence
- [ ] Accept/dismiss/escalate all work and require a reason
- [ ] Reset/cancel clears state cleanly
```

## What's Left to Do

**Current phase:** planning complete, implementation not started.

### Already done
- Brief reviewed, CR-01 incorporated
- Requirements List finalized
- Decision polls run, most ambiguities resolved
- Tech stack selected
- README in place

### Before implementation starts
- [ ] **Resolve the self-approval split**, blocks RBAC work
- [ ] Resolve remaining open ambiguities
- [ ] Select the 8–12 playbook categories from CUAD, justify the picks
- [ ] Repo set up, branch protection, PR review required

### Build order
- [ ] Intake form + RBAC + auth
- [ ] PDF ingestion + segmentation
- [ ] Manual identification screen
- [ ] Flag generation + review queue
- [ ] Escalation, disposition, audit record
- [ ] Reporting dashboard
- [ ] Deploy manual-only baseline
- [ ] Build `identify-provisions` function
- [ ] Wire in AI identification, fallback intact
- [ ] Section 6 verification suite

### Testing & verification
- [ ] RBAC per role, UI hidden (not locked) where unauthorized
- [ ] Manual fallback confirmed with AI disabled
- [ ] Gating confirmed
- [ ] No-reopen confirmed
- [ ] Low-confidence warning shows correctly

### Grading requirements, at a glance

| Requirement | Status |
|-------------|:---:|
| RBAC, server-side enforced | Not started |
| PDF ingestion + segmentation | Not started |
| AI identification w/ source span + confidence | Not started |
| Manual fallback (architectural test) | Not started |
| Review queue w/ reasons | Not started |
| Durable audit record | Not started |
| Reporting | Not started |
| Section 6 verification | Not started |
| No secrets in repo | Not started |
| Deployed public URL | Pending |
| README | Done *(add live URL later)* |
