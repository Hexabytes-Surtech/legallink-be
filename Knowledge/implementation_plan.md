c# Implementation Plan: New Instruction Migration

## Summary of Changes (Old → New)

### Auth Flow — Major Rewrite
| What | Old (Instruction.md) | New (new_istruction.md) |
|------|---------------------|------------------------|
| Register | `POST /api/auth/request-otp` — generic upsert, always role=citizen | `POST /api/auth/register` — accepts `email`, `role`, `preferred_language`; validates role; blocks admin self-reg; hashes OTP with bcrypt |
| Login | No separate login endpoint | `POST /api/auth/login` — email-only, requires `email_verified = true` |
| Verify OTP | `POST /api/auth/verify-otp` — plain OTP compare | `POST /api/auth/verify-otp` — bcrypt compare; creates advocate row on first verify; sets refresh cookie |
| Logout | Not implemented | `POST /api/auth/logout` — clears refresh_token + cookie |
| Refresh | `POST /api/auth/refresh` — from request body | `POST /api/auth/refresh-token` — reads from `req.cookies.refreshToken` |
| Advocate registration | Separate `POST /api/advocate/register` | **Removed** — advocate row created inside `verify-otp` |

### Profile APIs — Moved to `/api/user/*` and `/api/advocate/*`
| What | Old | New |
|------|-----|-----|
| User profile | Not separate | `PUT /api/user/profile` — phone, preferred_language (any authenticated user) |
| Avatar upload | Not separate | `POST /api/user/avatar` — Cloudinary upload, updates `users.avatar_url` |
| Advocate profile | `PUT /api/advocate/profile` — all fields required | `PUT /api/advocate/profile` — partial updates with COALESCE |
| Advocate documents | Same | `POST /api/advocate/documents` — field name = `document` |

### Endpoints to Remove
- `POST /api/advocate/register` — no longer needed
- `PUT /api/advocate/availability` — not in new spec
- `POST /api/advocate/submit-verification` — not in new spec
- `GET /api/advocate/dashboard` — not in new spec (Phase 1)
- `GET /api/advocate/consultations` — not in new spec (Phase 1)
- `GET /api/advocate/consultations/:id` — not in new spec (Phase 1)
- `PUT /api/advocate/consultations/:id` — not in new spec (Phase 1)
- `GET /api/advocate/messages` — not in new spec (Phase 1)
- `PUT /api/consultations/:id` — shared endpoint not in new spec (Phase 1)

### Files to Modify
1. **`identity/identity.controller.ts`** — rewrite: register, login, verify-otp, logout, refresh-token
2. **`identity/identity.service.ts`** — rewrite: all auth logic per new spec
3. **`identity/dto/request-otp.dto.ts`** → rename to `register.dto.ts`
4. **New DTO**: `login.dto.ts`
5. **`advocate/advocate.controller.ts`** — strip down to profile + documents only
6. **`advocate/advocate.service.ts`** — strip down, add partial update logic
7. **`advocate/dto/update-profile.dto.ts`** — make all fields optional for partial updates
8. **New controller**: `user/user.controller.ts` — user profile + avatar
9. **New service**: `user/user.service.ts`
10. **New module**: `user/user.module.ts`
11. **`app.module.ts`** — add UserModule
12. **`main.ts`** — add cookie-parser, change prefix to `api`

### New Files Needed
- `src/user/user.controller.ts`
- `src/user/user.service.ts`
- `src/user/user.module.ts`
- `src/user/dto/update-user-profile.dto.ts`
- `src/identity/dto/register.dto.ts` (replaces request-otp.dto.ts)
- `src/identity/dto/login.dto.ts`

### Files to Delete/Remove Content
- `src/advocate/dto/register-advocate.dto.ts` — no longer needed
- `src/advocate/dto/update-availability.dto.ts` — not in new spec
- `src/advocate/dto/update-consultation.dto.ts` — not in new spec (Phase 1)
- `src/advocate/consultation.controller.ts` — not in new spec (Phase 1)
- Dashboard/consultation/messages methods from advocate.service.ts
