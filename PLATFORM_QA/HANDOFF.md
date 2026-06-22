# LegalLink — Platform QA Handoff Document

**Date:** 2026-06-03  
**Branch (both repos):** `qa/platform-health`  
**Backend:** `legallink-be` on port 4000  
**Frontend:** `legallink-fe` on port 3000  
**AI:** Gemini (`gemini-flash-latest`) — direct in backend, no RAG  
**Author:** Claude (qa/ralph mode session)

---

## 1. Goal / Intention

The user's instruction was:

> Run both servers, explore the entire app comprehensively, map every multi-actor workflow end-to-end, write a test plan, execute it with Chrome DevTools, fix every bug/error/UI issue/logic problem/best-practice violation you find, re-test, loop until the platform is completely error-free. Do NOT stop until the platform is clean.

**Stack context:**
- `legallink-be` — NestJS 11, TypeScript, raw PostgreSQL (Neon), Socket.IO, Gemini AI, Cloudinary, Resend OTP
- `legallink-fe` — Next.js 16 (App Router, Turbopack), React 19, Tailwind v4, Socket.IO client, Shadcn-style UI
- `legallink-rag` — FastAPI Python RAG service. **Currently NOT connected** (`AI_SERVICE_URL=` is empty). Gemini handles AI. RAG integration is a future task (user said: "integrate rag at the end if you're capable, test that too").
- `legallink-ai` — not a git repo, ignored entirely

---

## 2. Environment Setup

### Branches created
```
legallink-be:  qa/platform-health  (from dev/parthib/scaling)
legallink-fe:  qa/platform-health  (from dev/parthib/UI)
```

### .env files created
| File | Location |
|------|----------|
| `.env` | `legallink-fe/.env` |
| `.env.development` | `legallink-be/.env.development` |

Both contain real secrets (Neon DB, Gemini, Cloudinary, Resend, JWT). Both are gitignored ✅

### Dev bypass credentials
- OTP bypass: `BYPASS_OTP_FOR_TESTING=true`, code = `000000`
- Admin user: `admin@min.legallink.local` (password via OTP bypass)
- Test citizen: `qa.citizen1@legallink-test.com`
- Test advocate: `qa.advocate1@legallink-test.com` — **verified by admin** during this session

### Start commands
```bash
# Backend (port 4000)
cd legallink-be && npm run start:dev

# Frontend (port 3000)
cd legallink-fe && npm run dev
```

---

## 3. Architecture Map

### Actors
| Actor | Role | Default redirect after login |
|-------|------|------------------------------|
| Citizen | Submits matters, requests consultations, chats | `/dashboard` |
| Advocate | Receives consultations, accepts/declines, chats | `/advocate/dashboard` |
| Admin | Verifies advocates, moderates flagged messages | `/admin` |
| Anonymous | Submit matter, browse advocates (no account) | — |

### Core Flows (all tested)
```
Anonymous → intake → AI brief → advocate list → signup → claim matter → request consultation
Advocate → signup → onboarding (4 steps) → submit verification → admin approves → verified
Admin → login → verify advocates → moderate flagged messages
Citizen → request consultation → advocate accepts → chat (WebSocket) → close → feedback
Moderation → Rule 36 BCI engine → phone/fee/promise in message → flagged → admin queue
```

### Key API contract
- Base: `http://localhost:4000/api`
- WS: `ws://localhost:4000/ws?token=<jwt>&consultationId=<uuid>`
- Swagger: `http://localhost:4000/api-docs`
- All responses: `{ success, data, meta }` or `{ success: false, error: { code, message } }`
- Auth: Bearer JWT in `Authorization` header + httpOnly refresh token cookie

---

## 4. Bugs Fixed (10 total)

| ID | Sev | Repo | Summary |
|----|-----|------|---------|
| BUG-001 | 🔴 | be+fe | Matter page crashed — `matchAdvocates` returned camelCase `practiceAreas`, FE expected snake_case `practice_areas` → `undefined.slice()` crash. Fixed: rewrote matching query to return public-directory-compatible card shape. |
| BUG-002 | 🟠 | be | Advocate matching missed ~half DB — seed data has mixed-case practice areas (`criminal_matter`, `tenancy_dispute`) but query only matched canonical Title Case. Fixed: pass both raw + canonical terms to query; normalise on profile save. |
| BUG-003 | 🔴 | fe | `/advocates` and `/advocates/[id]` were behind auth guard — public pages forced login. Fixed: moved to `(public)/(with-nav)` route group. |
| BUG-004 | 🟡 | fe | Advocate cards showed raw snake_case labels (`criminal_matter`, `tenancy_dispute`). Fixed: added `displayPracticeArea()` normaliser, applied to AdvocateCard, AiBrief, advocate consultation pages. |
| BUG-005 | 🟡 | fe | Advocate sidebar showed stale `verification_status` after submit-verification (layout `useQuery` had empty `[]` deps). Fixed: changed to `[pathname]` deps in advocate layout. Same fix applied to citizen layout. |
| BUG-006 | 🔴 | fe | Matter page showed "Matter not found" for logged-in citizen who owns the matter — `skipAuth: true` stripped Bearer token, backend's ownership check failed. Fixed: removed `skipAuth` from matter page + intake component. |
| BUG-007 | 🟡 | fe | Raw `matterType` (`tenancy_dispute`) shown in advocate consultation list, detail, and AI brief badge. Fixed: applied `displayPracticeArea()` to all three locations. |
| BUG-008 | 🔴 | fe | "Close consultation" missing from UI entirely — backend `PUT /consultations/:id/close` had no frontend trigger. Fixed: added `CloseConsultationButton` (two-step confirm) to citizen matters page. |
| BUG-009 | 🟡 | be+fe | "Leave feedback" stayed visible after feedback submitted. Fixed: added `hasFeedback` EXISTS subquery to consultation list; FE shows "Feedback submitted" indicator when true. |
| BUG-010 | 🟠 | be | `bio` missing from SELECT in `getMe` and `getMergedAdvocateProfile` — profile edit always showed empty bio. Fixed: added `a.bio` to both queries. |

---

## 5. Test Plan Status

Full test plan: `PLATFORM_QA/TEST_PLAN.md`  
Bug log: `PLATFORM_QA/BUG_LOG.md`

### Suites Completed

| Suite | Coverage | Status |
|-------|----------|--------|
| A — Public/Anonymous | A1–A4 full, A5–A6 pass | ✅ |
| B — Auth/OTP | B1–B6 (signup, login, unknown email, wrong OTP, lockout), B9/B10 (guards) | ✅ |
| C — Citizen | C1–C4 (dashboard, matters, anon claim, profile save), C6 (request consultation), C7 (avatar upload), C8 (unread badge) | ✅ |
| D — Advocate | D1–D9 (onboarding, verify, profile save, document upload, availability save, dashboard, consultation list, accept, decline) | ✅ |
| E — Chat/Consultation | E1–E3 (accept, WS connect, send/receive RT), E5 (moderation flag), E6 (close), E7 (feedback), E8 (closed read-only) | ✅ |
| F — Admin | F1–F7 (overview, pending, approve, reject, flagged messages, approve+dismiss) | ✅ |
| G — Cross-cutting | G3 (theme toggle), G4 (Bengali language), G5 (responsive mobile), G6 (a11y: 96/100), G7 (Lighthouse: 100/100/100) | ✅ |

### Suites NOT Yet Covered

| Suite | What's left |
|-------|-------------|
| E4 | Typing indicator (WS) — code fully implemented, untestable due to Turbopack dev crash on dynamic routes in isolated browser contexts |
| RAG integration | Not done — `legallink-rag` service not connected to backend |

---

## 6. Remaining Work

### Immediate (next session should tackle)

1. **RAG integration** — the user asked to integrate `legallink-rag` at the end:
   - Set `AI_SERVICE_URL=http://localhost:8000` in `.env.development`
   - The BE fallback chain already handles it: Gemini → AI_SERVICE_URL → mock
   - RAG runs on port 8000, needs its own `.env` with `DB_URL` and `VULTR_API_KEY`
   - Test: matter intake with RAG producing the brief vs Gemini

2. **Booking/appointment flow** — `consultation_appointment` table exists, `BookingDialog` component exists, but the appointment creation path wasn't fully tested end-to-end

3. **Commit & PR** — commit changes on `qa/platform-health` and open PRs into `dev/parthib/scaling` (be) and `dev/parthib/UI` (fe)

---

## 7. File Changes Summary

### `legallink-be` changes
| File | What changed |
|------|-------------|
| `src/matching/matching.service.ts` | Complete rewrite — returns public directory card shape (snake_case + bio/avatar/rating); accepts `candidateTerms[]` instead of single matterType |
| `src/matter/matter.service.ts` | Pass both raw + canonical practice area terms to matching; comment update |
| `src/advocate/advocate.service.ts` | `normalisePracticeAreas()` on profile save; `a.bio` + `a.rejection_reason` added to `getMe` SELECT; `rejectionReason` returned from `getDashboard` |
| `src/consultation/consultation.service.ts` | Added `hasFeedback` EXISTS subquery to `listMyCitizenConsultations` |
| `src/admin/admin.service.ts` | `verifyAdvocate()` now persists `rejection_reason` to DB column (previously only emailed it) |

### DB migrations applied
| Migration | SQL |
|-----------|-----|
| BUG-011 | `ALTER TABLE advocates ADD COLUMN IF NOT EXISTS rejection_reason TEXT` |

### `legallink-fe` changes
| File | What changed |
|------|-------------|
| `src/components/features/advocate-card.tsx` | Defensive array defaults; added + exported `displayPracticeArea()` normaliser; applied to badges |
| `src/components/features/ai-brief.tsx` | Applied `displayPracticeArea()` to matterType badge |
| `src/components/features/matter-intake.tsx` | Removed `skipAuth: true` — logged-in users create owned matters |
| `src/app/(public)/(with-nav)/advocates/` | **Moved here** from `(protected)/(citizen)/advocates/` — public route fix |
| `src/app/(public)/(with-nav)/advocates/[id]/page.tsx` | Applied `displayPracticeArea()` to practice area badges |
| `src/app/(public)/(with-nav)/matter/[id]/page.tsx` | Removed `skipAuth: true` from both API calls |
| `src/app/(protected)/advocate/layout.tsx` | Changed `useQuery` deps `[]` → `[pathname]` for fresh verification status |
| `src/app/(protected)/(citizen)/layout.tsx` | Changed `useQuery` deps `[]` → `[pathname]` for fresh user profile |
| `src/app/(protected)/advocate/consultations/page.tsx` | Applied `displayPracticeArea()` to matterType badge |
| `src/app/(protected)/advocate/consultations/[id]/page.tsx` | Applied `displayPracticeArea()` to matterType badge |
| `src/app/(protected)/(citizen)/matters/page.tsx` | Added `CloseConsultationButton` (two-step confirm); hide "Leave feedback" when `hasFeedback` is true |
| `src/app/(protected)/(citizen)/dashboard/page.tsx` | Removed `truncate` from stat labels — labels wrap on mobile instead of truncating |
| `src/app/(protected)/advocate/dashboard/page.tsx` | Rejection-specific banner: red card with reason text + "Update & re-submit" CTA when `verificationStatus === 'rejected'` |
| `src/app/(protected)/advocate/documents/page.tsx` | Fixed form field name `'file'` → `'document'` to match backend `FileInterceptor('document')` |
| `src/components/shared/navbar.tsx` | Account menu button `aria-label` now includes visible initials (fixes Lighthouse label-content-name-mismatch) |
| `src/i18n/config.ts` | Replaced 29 Unicode smart quotes with ASCII; added `adv.dash.rejected`, `adv.dash.rejectionReason`, `adv.dash.resubmit` keys (EN + BN) |
| `src/types/index.ts` | Added `hasFeedback?: boolean` to `ConsultationListItem`; added `rejectionReason: string \| null` to `AdvocateDashboard` |

### `PLATFORM_QA/` 
| File | Content |
|------|---------|
| `TEST_PLAN.md` | Full E2E test plan with 40+ test cases across 7 suites |
| `BUG_LOG.md` | 14 bugs (BUG-001 to BUG-014) with root cause, fix, and verification status |
| `HANDOFF.md` | This file |
| `screenshots/` | Mobile responsive screenshots (G5) |
| `lighthouse/` | Lighthouse report (96/100 accessibility, 100 best-practices/SEO) |

---

## 8. How to Resume in a New Chat

Tell Claude:

> "Read `PLATFORM_QA/HANDOFF.md` in the legallink organization folder. We're on branch `qa/platform-health` in both `legallink-be` and `legallink-fe`. Both servers need to be running (be on port 4000, fe on port 3000, start with `npm run start:dev` / `npm run dev`). Continue the platform QA from where we left off — complete the uncovered test cases in `TEST_PLAN.md` and then tackle the remaining work in section 6 of the handoff."

Provide these .env values again if needed (they're in the files but not in git):
- `legallink-fe/.env`
- `legallink-be/.env.development`

The OTP bypass is active (`BYPASS_OTP_FOR_TESTING=true`, code `000000`). Use it for all test flows.

---

## 9. Key Things to Know

- **DB is shared Neon Postgres** — single point of failure. All writes via API only, no destructive SQL.
- **Admin account:** `admin@min.legallink.local` (can't self-register; use OTP bypass to log in)
- **Test advocate `qa.advocate1@legallink-test.com`** is already `verified` in the DB from this session
- **Test matter** `ac624b9c-bc55-4677-b6bd-bf183ab51785` exists and is `closed` in DB
- **Practice areas** in DB are inconsistently cased (seed data). The matching and display layers now handle both formats. A one-time data cleanup to normalise all to Title Case would be a good future task.
- **RAG** is at `legallink-rag/` on branch `production`. It's a FastAPI service using LangGraph + BGE reranker + Vultr LLM. Not connected right now. The hook is `AI_SERVICE_URL` env var in the backend.
