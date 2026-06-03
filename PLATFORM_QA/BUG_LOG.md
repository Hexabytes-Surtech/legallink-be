# LegalLink — Bug Log

Format: each bug has an ID, severity, repo, location, description, root cause, fix, and verification status.

Severity: 🔴 blocker · 🟠 major · 🟡 minor · 🔵 polish/perf/best-practice

| ID | Sev | Repo | Status | Summary |
|----|-----|------|--------|---------|
| BUG-001 | 🔴 | be + fe | ✅ fixed | Matter page crashes — `/matter/:id/advocates` returned camelCase `practiceAreas`, FE AdvocateCard expects `practice_areas` → `undefined.slice()` |
| BUG-002 | 🟠 | be | ✅ fixed | Advocate matching misses half the DB — practice_areas stored as mixed case (seed data has `criminal_matter`, `tenancy_dispute`, etc.) but match query used canonical Title Case only. Fixed: pass both raw + canonical terms; normalise on profile save |
| BUG-003 | 🔴 | fe | ✅ fixed | `/advocates` and `/advocates/[id]` behind auth guard — public pages forced login. Moved to `(public)/(with-nav)` route group |
| BUG-004 | 🟡 | fe | ✅ fixed | Advocate cards displayed raw snake_case practice area labels (`criminal_matter`, `tenancy_dispute`) in UI. Added `displayPracticeArea()` normaliser in AdvocateCard + exported for reuse |
| BUG-005 | 🟡 | fe | ✅ fixed | Advocate sidebar shows stale verification_status after submit-verification — layout `useQuery` had `[]` deps (fetched once on mount, never re-fetched). Fixed to use `[pathname]` so sidebar stays fresh on navigation. Same fix applied to citizen layout avatar/name. |
| BUG-006 | 🔴 | fe | ✅ fixed | Matter page shows "Matter not found" for logged-in citizen who owns the matter — `skipAuth: true` stripped the Bearer token, so backend's ownership check (citizen_id match) failed with 404. Fixed: removed `skipAuth` from matter page + intake so token is sent when available. |
| BUG-007 | 🟡 | fe | ✅ fixed | Raw snake_case `matterType` (`tenancy_dispute`) shown in advocate consultations list, consultation detail, and AI brief classification badge. Applied `displayPracticeArea()` to all three locations. |
| BUG-008 | 🔴 | fe | ✅ fixed | "Close consultation" action missing entirely from UI — backend `PUT /consultations/:id/close` had no frontend trigger. Added `CloseConsultationButton` (two-step confirm) to citizen matters page for accepted consultations. |
| BUG-009 | 🟡 | be+fe | ✅ fixed | "Leave feedback" button shows on closed consultation even after feedback already submitted — could confuse users and shows API error on re-submit. Added `hasFeedback` EXISTS subquery to consultation list endpoint; FE shows "Feedback submitted" indicator instead of button when true. |
| BUG-010 | 🟠 | be | ✅ fixed | `bio` missing from SELECT in `getMe` and `getMergedAdvocateProfile` — advocate profile edit page always showed empty bio even after saving. Added `a.bio` to both queries. |
| BUG-011 | 🟠 | be+fe | ✅ fixed | Rejection reason not shown to advocate — admin rejection emails the reason but never stored it; dashboard always showed generic "not verified" banner regardless of rejected/pending/submitted status. Fix: `ALTER TABLE advocates ADD COLUMN rejection_reason TEXT`; BE saves reason on reject + returns it from dashboard; FE shows dedicated red banner with reason text and "Update & re-submit" CTA when `verificationStatus === 'rejected'`. |
| BUG-012 | 🔴 | fe | ✅ fixed | `src/i18n/config.ts` contained 29 Unicode smart quotes (U+2018/U+2019) used as JS string delimiters — file compiled from Turbopack cache on first load, but any edit forced a full recompile that failed with "Unexpected character '''". Fixed: replaced all curly quotes with ASCII `'`; converted 7 value strings containing apostrophes from single-quoted to double-quoted. |
| BUG-013 | 🟡 | fe | ✅ fixed | Citizen dashboard stat labels ("ACTIVE CONSULTATIONS", "PENDING REQUESTS", "UNREAD MESSAGES") truncated with "..." on mobile (375 px) 3-column layout — `truncate` CSS class clipped labels. Fixed: removed `truncate`, added `leading-tight` so labels wrap onto two lines instead. |
| BUG-014 | 🟠 | fe | ✅ fixed | Advocate document upload always returned 400 "Unexpected field - file" — frontend sent `FormData.append('file', ...)` but backend's `FileInterceptor('document')` expects the field name `document`. Fixed: changed `fd.append('file', file)` → `fd.append('document', file)` in `advocate/documents/page.tsx`. |

---

## Details

### BUG-001 — Matter detail page crashes on advocate matches
- **Severity:** 🔴 blocker (core anonymous flow A3/A4 dead)
- **Repo / file:** `legallink-be/src/matching/matching.service.ts`; `legallink-fe/src/components/features/advocate-card.tsx`
- **Found in:** test A4, iteration 1
- **Symptom:** After anonymous intake, `/matter/:id` renders the global error boundary ("Something went wrong"). Console: `TypeError: Cannot read properties of undefined (reading 'slice')` in `<AdvocateCard>`.
- **Root cause:** Two endpoints return advocate cards with different shapes. Public `/api/advocates` returns snake_case `practice_areas` + `bio/avatar_url/rating/rating_count` (matches FE contract). The matter endpoint `/api/matter/:id/advocates` went through `MatchingService` which returned camelCase `practiceAreas`/`enrolmentNumber` and omitted bio/avatar/rating. FE `AdvocateCard` reads `advocate.practice_areas` → undefined → `.slice()` throws, taking down the whole route.
- **Fix:** (1) Rewrote `MatchingService.matchAdvocates` to select the identical card columns as the public directory (snake_case, + rating join). (2) Hardened `AdvocateCard` to default missing arrays to `[]` so a malformed payload can never crash the page again.
- **Verified:** pending re-run (iteration 2)

<!-- BUG-NNN template
### BUG-001 — <title>
- **Severity:** 🔴/🟠/🟡/🔵
- **Repo / file:** legallink-be/src/...:line
- **Found in:** test <ID>, iteration <n>
- **Symptom:** what the user/tester observes
- **Root cause:** why
- **Fix:** what changed
- **Verified:** ✅ re-ran test <ID> iteration <n+1>
-->

---

## Iteration 2026-06-03 — Code-review remediation (Backend_Review.txt, 15 findings)

All 15 findings re-verified against current source (some were already partly
remediated), fixed, and — where runtime-testable — proven via live API calls
against the migrated Neon DB. Sev: 🔴 blocker · 🟠 major · 🟡 minor.

| ID | Sev | File | Fix | Verified |
|----|-----|------|-----|----------|
| BUG-015 | 🔴 | consultation.service.ts | Anon-matter hijack: `requestConsultation` now applies the same `session_id` check as `getMatterById` — a NULL-owner matter can only be claimed by the session that created it | ✅ live: stranger→403, legit session→201 |
| BUG-016 | 🔴 | identity.service.ts | OTP bypass backdoor hard-gated on `NODE_ENV!=='production'` + non-empty code required | ✅ logic: prod/empty/wrong→false |
| BUG-017 | 🔴 | consultation.service.ts + Sql/017 | Booking double-book race: partial unique index `uq_appt_advocate_slot (advocate_id, scheduled_at) WHERE status='scheduled'` + 23505 catch | ✅ live concurrent: one 201, one 409 |
| BUG-018 | 🟠 | appointment.service.ts | Reschedule race: same index + 23505 catch | ✅ live: taken→409, free→scheduled |
| BUG-019 | 🟠 | advocate.service.ts | Verified advocate can no longer mutate `bar_enrolment_number`/`state_bar` (credential lock) | ✅ live: change→400, bio-only→200 |
| BUG-020 | 🟠 | identity.service.ts | OTP now `crypto.randomInt` (CSPRNG) instead of `Math.random` | ✅ live register/login; grep: 0 Math.random |
| BUG-021 | 🟠 | availability.service.ts | `getPublicSlots` validates `from`/`to` → 400 on malformed/impossible dates (was unhandled 500) | ✅ live: abc/2026-02-30→400 |
| BUG-022 | 🟠 | advocate.service.ts | Declining a consultation cancels its scheduled appointment (slot no longer blocked forever) | ✅ live: decline→cancelled→slot freed |
| BUG-023 | 🟠 | matter.service.ts + matching.service.ts | Pagination total uses a real count; `page`/`limit` clamped (NaN no longer 500s) | ✅ live: ?limit=abc→200, total/pages correct |
| BUG-024 | 🟠 | Sql/017_QaHardening.sql | `advocates.rejection_reason` committed as a migration (was manual ALTER only) | ✅ applied to Neon |
| BUG-025 | 🟠 | advocate.service.ts | `getAdvocateByUserId` now SELECTs `rejection_reason` (+ bio) → dashboard reason no longer always null | ✅ live: rejected advocate sees reason |
| BUG-026 | 🟡 | matter.service.ts | District ranking reads `classification_json.location.district` (ignoring null/"Not specified") | ✅ matching exercised live |
| BUG-027 | 🟠 | advocate.service.ts | Accept/decline made atomic: `AND status='pending'` + rowCount; decline also frees the slot in one tx | ✅ live: 2nd transition→400 |
| BUG-028 | 🟠 | conversation.gateway.ts | WS message insert wrapped in try/catch; emits `MESSAGE_SEND_FAILED` instead of silently losing the message | ✅ code |
| BUG-029 | 🟠 | email.service.ts | Advocate-controlled name/reason HTML-escaped in all emails (link/markup injection) | ✅ logic: `<a…>`→`&lt;a…` |

**Migration:** `Sql/017_QaHardening.sql` — adds `consultation_appointment.advocate_id`
(backfilled, NOT NULL) + `uq_appt_advocate_slot` partial unique index + idempotent
`rejection_reason`. Applied to Neon 2026-06-03.
