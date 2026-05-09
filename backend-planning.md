## Plan: Advocate Onboarding + Dashboard APIs

Deliver a minimal, raw-Postgres onboarding and dashboard API set for advocates in NestJS, with a chat-style onboarding flow and a small schema that captures identity, specialization, availability, and pricing plus verification status.

**Steps**
1. Define the minimal schema in DBML and map it to raw SQL access patterns: advocates (core profile + status), advocate_documents (Bar Council ID + government ID), advocate_specializations (join), advocate_languages (join), advocate_availability (slots), advocate_pricing (consultation fee). Keep fields minimal but sufficient for onboarding and dashboard status.
2. Add a simple onboarding state model (draft, in_review, verified, rejected) and profile completion checkpoints, stored on the advocate row to support the chat-guided flow.
3. Implement onboarding endpoints in AdvocateController/Service using raw SQL queries: start/create draft profile, update profile segments, upload document metadata, set availability/pricing, submit for verification, and fetch onboarding status.
4. Implement dashboard endpoints: profile summary with completion + verification status, appointments list, earnings summary, messages list, and availability schedule list. Keep message/earnings endpoints as data stubs or read-only placeholders until the related subsystems exist.
5. Add request DTOs + validation for onboarding steps (progressive updates) so the chat flow can send partial payloads per step.
6. Wire any new provider classes into the module and add minimal tests for core onboarding state transitions and status endpoint responses.

**Relevant files**
- [LegalLink-Backend/src/advocate/advocate.controller.ts](LegalLink-Backend/src/advocate/advocate.controller.ts) — add onboarding and dashboard endpoints
- [LegalLink-Backend/src/advocate/advocate.service.ts](LegalLink-Backend/src/advocate/advocate.service.ts) — add raw SQL data access + onboarding state logic
- [LegalLink-Backend/src/app.module.ts](LegalLink-Backend/src/app.module.ts) — register any new providers or modules

**Verification**
1. Run unit tests for advocate service/controller and ensure onboarding state transitions work as expected.
2. Manual API checks: create draft, fill profile, upload docs metadata, set availability/pricing, submit, then fetch status/dashboard summary.
3. Validate DB constraints: required fields for submission and unique constraints for Bar Council ID.

**Decisions**
- Onboarding flow is chat-style with progressive, partial updates rather than a single form submission.
- v1 verification documents are Bar Council ID and government ID only.
- Matching signals (location, specialization, languages, experience) are stored now but matching logic ships later in LegalLink-AI.

**Further Considerations**
1. Document storage choice (local, S3, or third-party) affects advocate_documents storage fields.
2. Appointment/earnings/messages sources are undefined; decide whether to stub or integrate with future subsystems.
