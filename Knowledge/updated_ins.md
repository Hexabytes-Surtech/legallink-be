I already have your database schema — it's in the `001_Schema.dbml` file you shared earlier. I can see the full `users`, `advocates`, `advocate_verification_documents`, and all other tables clearly.

Now let me design the missing GET APIs and the middleware architecture.Here's the complete set of missing GET APIs, plus the middleware architecture update.

**The middleware flow is the backbone of everything** — once `requireAuth` attaches `req.user` (with `userId` and `role`), every downstream route can fetch exactly what it needs without the client sending a user ID explicitly. Here's the full picture:


# Auth Middleware & GET API Flow

## Middleware Chain (applied to all protected routes)

1. **requireAuth** (runs first on every protected route)
   - Reads `Authorization: Bearer <accessToken>` header
   - Verifies JWT signature and expiry
   - On failure → return 401 { code: "UNAUTHORIZED" }
   - On success → attaches to request:
     req.user = { userId, role, email }  ← decoded from JWT payload, no DB call

2. **requireRole('advocate')** (stacked AFTER requireAuth, only on advocate routes)
   - Checks req.user.role === 'advocate'
   - On failure → return 403 { code: "FORBIDDEN" }
   - On success → passes through to route handler

---

## Route Definitions

### Citizen + Advocate shared

GET /api/user/me
  - Middleware: requireAuth
  - Handler:
      SELECT id, email, email_verified, phone, role,
             preferred_language, avatar_url, created_at, updated_at
      FROM users
      WHERE id = req.user.userId
  - Response 200: user object (never return otp_code, refresh_token, or their expiry fields)

### Advocate only

GET /api/advocate/me
  - Middleware: requireAuth → requireRole('advocate')
  - Handler:
      SELECT a.*, u.email AS auth_email, u.preferred_language, u.avatar_url
      FROM advocates a
      JOIN users u ON u.id = a.user_id
      WHERE a.user_id = req.user.userId
  - Response 200: merged advocate + user fields including verification_status
  - Response 404: { code: "ADVOCATE_PROFILE_NOT_FOUND" } if no advocates row exists

GET /api/advocate/documents
  - Middleware: requireAuth → requireRole('advocate')
  - Handler (two steps):
      Step 1: SELECT id FROM advocates WHERE user_id = req.user.userId  → get advocate_id
      Step 2: SELECT id, file_path, file_type, uploaded_at
              FROM advocate_verification_documents
              WHERE advocate_id = $advocate_id
              ORDER BY uploaded_at DESC
  - Response 200: array of document objects
  - file_path contains the Cloudinary URL

---

## JWT Payload Contract
  Every accessToken issued by verify-otp or login MUST include:
  {
    userId:  users.id (uuid),
    role:    users.role (citizen | advocate | admin),
    email:   users.email
  }
  This is what requireAuth decodes and assigns to req.user.
  The client never sends userId in the body or URL — the token carries it.

---

## Middleware Stack Examples

Public route (no middleware):
  POST /api/auth/register
  POST /api/auth/login
  POST /api/auth/verify-otp
  POST /api/auth/refresh-token

Citizen OR advocate route:
  requireAuth → handler
  Applies to: GET /api/user/me, PUT /api/user/profile, POST /api/user/avatar

Advocate-only route:
  requireAuth → requireRole('advocate') → handler
  Applies to: GET /api/advocate/me, PUT /api/advocate/profile,
              POST /api/advocate/documents, GET /api/advocate/documents

---

## Fields Never Returned in Any Response
  - users.otp_code
  - users.otp_expires_at
  - users.refresh_token
  - users.refresh_token_expires_at

Now here are the full API specifications:

---

## Middleware Update — `requireAuth`

When any of the auth APIs (`verify-otp`, `login`) issue a JWT, the payload must include:

```json
{ "userId": "uuid", "role": "citizen|advocate|admin", "email": "user@example.com" }
```

Then `requireAuth` does this on every protected route — **no DB call needed**:

```js
req.user = { userId, role, email }  // decoded from the JWT
```

The `userId` from `req.user` is what every GET API below uses as the lookup key. The client never sends a user ID in the body or URL — the token carries it.

---

## New GET APIs to Add

**API — GET `/api/user/me`**
- Protected. Any authenticated user.
- Read `userId` from `req.user`.
- `SELECT id, email, email_verified, phone, role, preferred_language, avatar_url, created_at, updated_at FROM users WHERE id = $userId`.
- Never return `otp_code`, `otp_expires_at`, `refresh_token`, `refresh_token_expires_at`.
- Response: `200` with the safe user object.

---

**API — GET `/api/advocate/me`**
- Protected. Requires `role = advocate` (stack `requireRole('advocate')` after `requireAuth`).
- Read `userId` from `req.user`.
- Join query: `SELECT a.*, u.email as auth_email, u.preferred_language, u.avatar_url FROM advocates a JOIN users u ON u.id = a.user_id WHERE a.user_id = $userId`.
- If no advocate row exists (shouldn't happen after `verify-otp` flow, but guard it), return `404 ADVOCATE_PROFILE_NOT_FOUND`.
- Response: merged advocate + user fields. Include `verification_status` so the frontend knows whether to show a "pending verification" banner.

---

**API — GET `/api/advocate/documents`**
- Protected. `requireRole('advocate')`.
- Read `userId` from `req.user`. First resolve `advocate_id`: `SELECT id FROM advocates WHERE user_id = $userId`.
- Then `SELECT id, file_path, file_type, uploaded_at FROM advocate_verification_documents WHERE advocate_id = $advocateId ORDER BY uploaded_at DESC`.
- Response: array of document objects. `file_path` here is the Cloudinary URL (since your updated instruction uses Cloudinary for documents too).

---

## Updates to Existing APIs

**`verify-otp` and `login` — JWT payload must include `email`** alongside `userId` and `role`. This way `requireAuth` can expose `req.user.email` without a DB round-trip for APIs that need it (e.g. for audit logs or email display).

**`PUT /api/user/profile` (API 5)** — currently has no corresponding GET. After these additions, the frontend flow is: call `GET /api/user/me` on app load → pre-fill the profile form → submit changes via `PUT /api/user/profile`.

---

## Complete Updated Route Table

| # | Method | Endpoint | Auth | Purpose |
|---|--------|----------|------|---------|
| 1 | POST | `/api/auth/register` | None | Register + send OTP |
| 2 | POST | `/api/auth/verify-otp` | None + cookie | Verify OTP, issue tokens |
| 3 | POST | `/api/auth/login` | None | Login + send OTP |
| 4 | POST | `/api/auth/logout` | Bearer | Clear refresh token |
| 5 | POST | `/api/auth/refresh-token` | Cookie | Issue new access token |
| 6 | **GET** | **`/api/user/me`** | Bearer | Fetch own user profile |
| 7 | PUT | `/api/user/profile` | Bearer | Update phone, language |
| 8 | POST | `/api/user/avatar` | Bearer | Upload avatar |
| 9 | **GET** | **`/api/advocate/me`** | Bearer + advocate role | Fetch own advocate profile |
| 10 | PUT | `/api/advocate/profile` | Bearer + advocate role | Update advocate fields |
| 11 | POST | `/api/advocate/documents` | Bearer + advocate role | Upload CoP document |
| 12 | **GET** | **`/api/advocate/documents`** | Bearer + advocate role | List own uploaded documents |

The three bolded GET routes are the additions. Everything else in your existing plan stays unchanged.