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
