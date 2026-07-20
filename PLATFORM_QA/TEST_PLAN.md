# LegalLink — Platform Health E2E Test Plan

> Branch: `qa/platform-health` (both `legallink-be` and `legallink-fe`)
> Backend: http://localhost:4000/api · WS `/ws` · Swagger `/api-docs`
> Frontend: http://localhost:3000
> AI: Gemini (`gemini-flash-latest`) direct. RAG service OFF (`AI_SERVICE_URL` empty).
> Dev auth: OTP bypass `000000` (`BYPASS_OTP_FOR_TESTING=true`).
> DB: Neon (shared, single point of failure) — diagnostics READ-ONLY, all writes via API.

## Actors
- **Anonymous visitor** — lands, submits a matter, browses advocates (no account).
- **Citizen** — registered user; matters, advocates, consultations, chat, feedback.
- **Advocate** — onboarding/verification, profile, availability, consultations, chat, reviews.
- **Admin** — advocate verification queue, flagged-message moderation.

## Test accounts (created via API with OTP bypass during run)
| Role | Email | Notes |
|------|-------|-------|
| citizen | qa.citizen+<run>@example.com | new registration |
| advocate | qa.advocate+<run>@example.com | new registration → onboarding |
| admin | (existing admin row, if any) | admin can't self-register |

---

## Legend
Status: ⬜ not run · 🟡 in progress · ✅ pass · ❌ fail (see BUG_LOG.md) · ⏭️ skipped

---

## SUITE A — Public / Anonymous
| ID | Flow | Steps | Expected | Status |
|----|------|-------|----------|--------|
| A1 | Landing renders | Load `/` | Hero, intake CTA, no console errors | ⬜ |
| A2 | Anonymous matter intake | `/intake` → enter ≥20-char query, pick language → submit | 201, redirect to `/matter/:id`, `legallink_session` cookie set | ⬜ |
| A3 | AI brief renders | On `/matter/:id` | Gemini brief (EN/BN), citations, disclaimer, next steps | ⬜ |
| A4 | Matched advocates | matter page advocate list | Verified advocates shown, paginated | ⬜ |
| A5 | Public advocate directory | `/advocates` | List, filters (practice area, language, district), pagination | ⬜ |
| A6 | Public advocate profile | `/advocates/:id` | Profile, reviews, availability; NO email/phone (BCI) | ⬜ |
| A7 | Validation guards | submit <20-char query | 400 surfaced as friendly error, no crash | ⬜ |

## SUITE B — Auth / OTP
| ID | Flow | Steps | Expected | Status |
|----|------|-------|----------|--------|
| B1 | Citizen signup | `/auth/signup` → email → OTP `000000` | account created, redirect `/dashboard` | ⬜ |
| B2 | Advocate signup | `/auth/advocate-signup` → email → OTP | redirect `/advocate/dashboard` (or onboarding) | ⬜ |
| B3 | Login existing | `/auth/login` → email → OTP | role-aware redirect | ⬜ |
| B4 | Login no account | unknown email | 404 friendly message | ⬜ |
| B5 | Wrong OTP | enter `111111` | error shown; not logged in | ⬜ |
| B6 | OTP lockout | 5 wrong OTPs | 429 OTP_LOCKED with retryAfter | ⬜ |
| B7 | Token refresh | let access expire / reload | silent refresh via cookie, session persists | ⬜ |
| B8 | Logout | user menu → logout | tokens cleared, redirect `/` | ⬜ |
| B9 | Protected guard | hit `/dashboard` logged out | redirect `/auth/login?returnTo=` | ⬜ |
| B10 | Role guard | citizen hits `/admin` | blocked/redirected | ⬜ |

## SUITE C — Citizen
| ID | Flow | Steps | Expected | Status |
|----|------|-------|----------|--------|
| C1 | Dashboard | `/dashboard` | stats, recent matters, consultations | ⬜ |
| C2 | Matters list | `/matters` | all matters + consultation status | ⬜ |
| C3 | Anonymous matter claim | signup after anon intake | matter now owned by citizen | ⬜ |
| C4 | Profile edit | `/profile` | name/address/language update persists | ⬜ |
| C5 | Browse + filter advocates | `/advocates` | filters work | ⬜ |
| C6 | Request consultation | advocate profile → Connect → submit | consultation `pending` created | ⬜ |
| C7 | Avatar upload | settings → upload image | avatar_url set | ⬜ |
| C8 | Unread badge | nav consultation badge | reflects unread count | ⬜ |

## SUITE D — Advocate
| ID | Flow | Steps | Expected | Status |
|----|------|-------|----------|--------|
| D1 | Onboarding wizard | `/advocate/onboarding` 4 steps | profile saved | ⬜ |
| D2 | Submit verification | submit | status `submitted` | ⬜ |
| D3 | Profile edit | `/advocate/profile` | practice areas, bio (≤300), districts persist | ⬜ |
| D4 | Documents upload | `/advocate/documents` | doc uploaded, listed | ⬜ |
| D5 | Availability grid | `/advocate/availability` | weekly slots save (dayOfWeek 0–6, HH:MM) | ⬜ |
| D6 | Dashboard | `/advocate/dashboard` | verification status, stats, completeness | ⬜ |
| D7 | Consultations list | `/advocate/consultations` | pending/accepted/declined/closed tabs | ⬜ |
| D8 | Accept consultation | detail → accept | status accepted, chat opens | ⬜ |
| D9 | Decline consultation | detail → decline + reason | status declined | ⬜ |
| D10 | Reviews | `/advocate/reviews` | rating list, visibility | ⬜ |

## SUITE E — Consultation + Chat (multi-actor)
| ID | Flow | Steps | Expected | Status |
|----|------|-------|----------|--------|
| E1 | Citizen → request → advocate accept | two sessions | consultation moves pending→accepted | ⬜ |
| E2 | WS connect both sides | open `/chat/:id` as both | connected, history loads | ⬜ |
| E3 | Send + receive | citizen sends, advocate receives live | message appears both sides | ⬜ |
| E4 | Typing indicator | type in one | peer sees typing | ⬜ |
| E5 | Moderation flag | send phone number / fee / "guarantee win" | message flagged, hidden from peer, visible-to-sender as under review | ⬜ |
| E6 | Close consultation | citizen closes accepted | status closed, chat read-only | ⬜ |
| E7 | Feedback | citizen leaves rating after close | feedback created, once only | ⬜ |
| E8 | Closed chat read-only | reopen closed chat | input disabled | ⬜ |

## SUITE F — Admin (multi-actor)
| ID | Flow | Steps | Expected | Status |
|----|------|-------|----------|--------|
| F1 | Admin overview | `/admin` | queue counts | ⬜ |
| F2 | Pending advocates | `/admin/advocates` | submitted advocates listed with docs | ⬜ |
| F3 | Approve advocate | approve | advocate verified, appears in public dir | ⬜ |
| F4 | Reject advocate | reject + reason | advocate rejected | ⬜ |
| F5 | Flagged messages | `/admin/messages` | flagged messages from E5 listed | ⬜ |
| F6 | Approve flagged | approve | message becomes visible to peer | ⬜ |
| F7 | Dismiss flagged | dismiss | message stays hidden | ⬜ |

## SUITE G — Cross-cutting
| ID | Area | Check | Status |
|----|------|-------|--------|
| G1 | Console errors | zero uncaught errors across all pages | ⬜ |
| G2 | Network failures | no unexpected 4xx/5xx in normal flows | ⬜ |
| G3 | Theme toggle | dark/light switch | ⬜ |
| G4 | Language toggle | EN/BN switch | ⬜ |
| G5 | Responsive | mobile viewport key pages | ⬜ |
| G6 | a11y basics | labels, focus, tap targets on forms | ⬜ |
| G7 | Perf | no obviously slow page / waterfall | ⬜ |

---

## Iteration log
Each ralph-mode pass appended below with date, results, and fixes.

### Iteration 0 — setup (2026-06-03)
- Both servers boot clean (BE 0 compile errors; FE ready in 2.6s).
- DB reachable: 23 tables, 19 users / 9 advocates / 92 matters / 3 consultations.
- Public endpoints 200. Test execution begins next.
