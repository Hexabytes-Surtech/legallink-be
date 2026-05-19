# Advocate Backend – Complete Implementation Instructions
## Person 1 (Advocate Backend Developer) — LegalLink Platform

---

## 0. What Already Exists

| Layer | Status | Notes |
|---|---|---|
| DB Schema + Migrations | ✅ Done | 001 + 002 + 003 applied on Neon |
| `users` table | ✅ Ready | email, role, email_verified, otp, refresh_token, avatar_url |
| `advocates` table | ✅ Ready | user_id FK, all BCI fields, array fields with GIN indexes |
| `advocate_verification_documents` | ✅ Ready | linked to advocates |
| `consultations` + `messages` | ✅ Ready | Person 2 uses messages; you use consultations |
| NestJS app | ✅ Running | modules: identity, advocate, user, admin, cloudinary |
| JWT (passport-jwt) | ✅ Done | access token (Bearer) + refresh token (httpOnly cookie) |
| Cloudinary + Multer | ✅ Done | `CloudinaryService.uploadFile()` ready |
| Resend (email OTP) | ✅ Done | `IdentityService` sends OTP via Resend |

---

## SCHEMA VALIDATION ✅

**DB schema is correct and complete. No changes needed.**

Key design decisions:
- `users.role = 'advocate'` is the trigger — on OTP verify, a placeholder `advocates` row is auto-created (`identity.service.ts` lines 138–150).
- `advocates.user_id` is the bridge — always look up advocate via `WHERE user_id = $1` using `user.sub` from JWT. Never route by `advocate.id`.
- `advocates.email` = professional CoP contact email. `users.email` = login/OTP email. They are separate.
- `avatar_url` lives in `users` table, uploaded via `POST /api/user/avatar`.
- `preferred_language` is collected **after registration** during profile fill — NOT at registration time.

---

## ANSWER: One Route or Two for Registration?

**Use ONE route: `POST /api/auth/register`** with `role` in body.

```json
{ "email": "adv@example.com", "role": "advocate" }
{ "email": "cit@example.com", "role": "citizen" }
```

`preferred_language` is **not** sent at registration. The user sets it later via `PUT /api/user/profile`. Default `'en'` is stored in DB until they update it.

---

## STEP-BY-STEP IMPLEMENTATION PLAN

---

## STEP 1 — Update `RegisterDto` (Remove `preferred_language`)

**File:** `src/identity/dto/register.dto.ts`

The DTO must only accept `email` and `role`. Remove `preferred_language` if it exists:

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'advocate@gmail.com' })
  email: string;

  @ApiProperty({ enum: ['citizen', 'advocate'] })
  role: string;
}
```

Also update `identity.service.ts` → `register()` method signature:
```typescript
async register(email: string, role: string) { ... }
```

And the controller call:
```typescript
register(@Body() dto: RegisterDto) {
  return this.identityService.register(dto.email, dto.role);
}
```

The DB will use `preferred_language = 'en'` as the default (already set in schema). Advocate updates it later via their profile.

---

## STEP 2 — Understand the Full Auth Flow (No Code Change, Just Verify)

### Registration Flow (Advocate & Citizen — same route)
```
POST /api/auth/register
Body: { email, role }
→ Validates role (citizen | advocate only — admin blocked)
→ If new user: INSERT into users with email_verified=false, role, default lang='en'
→ If existing unverified: UPDATE otp fields only
→ Sends 6-digit OTP to email via Resend
→ Response 202: { expiresInSeconds: 600 }
```

### OTP Verification Flow
```
POST /api/auth/verify-otp
Body: { email, otp }
→ Checks OTP hash match + expiry
→ Sets email_verified = true, clears OTP fields
→ If role = 'advocate': auto-creates placeholder advocates row
→ Issues accessToken (JWT, 15min) + refreshToken (cookie, 7 days)
→ Response 200: { accessToken, user: { userId, email, role } }
```

### Login Flow (Citizen AND Advocate — same route)
```
POST /api/auth/login
Body: { email }
→ Checks user exists and email_verified = true
→ Generates new OTP, sends via Resend
→ Response 202: { expiresInSeconds: 600 }

Then: POST /api/auth/verify-otp (same as above)
→ Issues new accessToken + refreshToken
```

### Refresh Token Flow
```
POST /api/auth/refresh-token
Cookie: refreshToken (auto-sent by browser)
→ Verifies JWT signature of refresh token
→ Checks hash match in DB
→ Issues new accessToken
→ Response 200: { accessToken }
```

### Logout Flow
```
POST /api/auth/logout
Header: Authorization: Bearer <accessToken>
→ Nulls refresh_token in DB
→ Clears refreshToken cookie
→ Response 200: { message: 'Logged out successfully' }
```

**Why JWT `sub` = `users.id`:**
- Every advocate endpoint calls `getAdvocateByUserId(user.sub)`
- `user_id` in advocates is UNIQUE + indexed → O(1) lookup
- No need to store or expose `advocate.id` on the client side

---

## STEP 3 — Update `UpdateUserProfileDto` (Add `preferred_language`)

**File:** `src/user/dto/update-user-profile.dto.ts`

`preferred_language` must be here (not at registration). This is how advocates and citizens set their language preference after signing up:

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserProfileDto {
  @ApiProperty({ example: 'bn', enum: ['bn', 'en'], required: false })
  preferred_language?: string;
}
```

Update `user.service.ts` → `updateProfile()` to handle `preferred_language` in its dynamic SET clause.

---

## STEP 4 — Add Consultation Endpoints to Advocate Module

This is the most important missing piece. `advocate.controller.ts` currently has: `GET /me`, `PUT /profile`, `GET /documents`, `POST /documents`. You must add:

### Step 4A — New DTO

**New file:** `src/advocate/dto/consultation-action.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class ConsultationActionDto {
  @ApiProperty({ enum: ['accept', 'decline'] })
  action: 'accept' | 'decline';

  @ApiProperty({ required: false, example: 'Schedule conflict' })
  declineReason?: string;
}
```

### Step 4B — New Service Methods in `advocate.service.ts`

Add these inside `AdvocateService` class:

```typescript
async getConsultations(userId: string) {
  const advocate = await this.getAdvocateByUserId(userId);
  const result = await this.db.query(
    `SELECT c.id, c.status, c.requested_at, c.accepted_at,
            m.query_text, m.query_language, m.classification,
            u.id AS citizen_user_id
     FROM consultations c
     JOIN matters m ON m.id = c.matter_id
     JOIN users u ON u.id = c.citizen_id
     WHERE c.advocate_id = $1
     ORDER BY c.requested_at DESC`,
    [advocate.id],
  );
  return result.rows;
}

async getConsultationById(userId: string, consultationId: string) {
  const advocate = await this.getAdvocateByUserId(userId);
  const result = await this.db.query(
    `SELECT c.id, c.status, c.requested_at, c.accepted_at,
            m.id AS matter_id, m.query_text, m.query_language,
            m.classification, m.citations,
            m.ai_response_english, m.ai_response_bengali,
            u.id AS citizen_user_id
     FROM consultations c
     JOIN matters m ON m.id = c.matter_id
     JOIN users u ON u.id = c.citizen_id
     WHERE c.id = $1 AND c.advocate_id = $2`,
    [consultationId, advocate.id],
  );
  if (!result.rows.length) throw new NotFoundException('Consultation not found');
  return result.rows[0];
}

async updateConsultation(
  userId: string,
  consultationId: string,
  action: 'accept' | 'decline',
  declineReason?: string,
) {
  const advocate = await this.getAdvocateByUserId(userId);
  const existing = await this.db.query(
    `SELECT id, status FROM consultations WHERE id = $1 AND advocate_id = $2`,
    [consultationId, advocate.id],
  );
  if (!existing.rows.length) throw new NotFoundException('Consultation not found');
  if (existing.rows[0].status !== 'requested')
    throw new BadRequestException('Consultation is not in requested state');

  const newStatus = action === 'accept' ? 'accepted' : 'declined';
  await this.db.query(
    `UPDATE consultations
     SET status = $1, accepted_at = ${action === 'accept' ? 'NOW()' : 'NULL'}
     WHERE id = $2`,
    [newStatus, consultationId],
  );
  return { consultationId, status: newStatus, ...(declineReason && { declineReason }) };
}

async getDashboard(userId: string) {
  const advocate = await this.getAdvocateByUserId(userId);
  const stats = await this.db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'requested') AS pending_count,
       COUNT(*) FILTER (WHERE status = 'accepted')  AS accepted_count,
       COUNT(*) FILTER (WHERE status = 'declined')  AS declined_count,
       COUNT(*) FILTER (WHERE status = 'closed')    AS closed_count,
       COUNT(*)                                      AS total_count
     FROM consultations WHERE advocate_id = $1`,
    [advocate.id],
  );
  return {
    advocateId: advocate.id,
    verificationStatus: advocate.verification_status,
    profileCompleteness: this.calculateProfileCompleteness(advocate),
    consultationStats: stats.rows[0],
  };
}

async submitVerification(userId: string) {
  const advocate = await this.getAdvocateByUserId(userId);
  if (advocate.verification_status === 'verified')
    throw new BadRequestException('Already verified');
  if (!advocate.bar_enrolment_number || !advocate.state_bar || !advocate.name || !advocate.address)
    throw new BadRequestException('Complete your profile before submitting for verification');
  return {
    advocateId: advocate.id,
    verificationStatus: advocate.verification_status,
    message: 'Profile submitted for admin review',
  };
}

private calculateProfileCompleteness(advocate: any): number {
  const fields = [
    advocate.bar_enrolment_number,
    advocate.state_bar,
    advocate.name,
    advocate.address,
    advocate.practice_areas?.length > 0,
    advocate.courts?.length > 0,
    advocate.languages?.length > 0,
    advocate.districts?.length > 0,
  ];
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
}
```

### Step 4C — New Controller Methods in `advocate.controller.ts`

Update imports:
```typescript
import {
  Controller, Get, Put, Post, Body, Param, HttpCode,
  UseGuards, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { ConsultationActionDto } from './dto/consultation-action.dto';
```

Add these methods after the existing ones:

```typescript
@Get('dashboard')
@ApiOperation({ summary: 'Dashboard: stats + profile completeness' })
@ApiResponse({ status: 200, description: 'Dashboard data' })
getDashboard(@CurrentUser() user: JwtPayload) {
  return this.advocateService.getDashboard(user.sub);
}

@Get('consultations')
@ApiOperation({ summary: 'List all incoming consultations' })
@ApiResponse({ status: 200, description: 'Array of consultation objects' })
getConsultations(@CurrentUser() user: JwtPayload) {
  return this.advocateService.getConsultations(user.sub);
}

@Get('consultations/:id')
@ApiOperation({ summary: 'Get single consultation detail' })
@ApiResponse({ status: 200, description: 'Full consultation with matter info' })
@ApiResponse({ status: 404, description: 'Consultation not found' })
getConsultationById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
  return this.advocateService.getConsultationById(user.sub, id);
}

@Put('consultations/:id')
@ApiOperation({ summary: 'Accept or decline a consultation' })
@ApiBody({ type: ConsultationActionDto })
@ApiResponse({ status: 200, description: 'Status updated' })
updateConsultation(
  @CurrentUser() user: JwtPayload,
  @Param('id') id: string,
  @Body() dto: ConsultationActionDto,
) {
  return this.advocateService.updateConsultation(user.sub, id, dto.action, dto.declineReason);
}

@Post('submit-verification')
@HttpCode(200)
@ApiOperation({ summary: 'Submit profile for admin verification' })
@ApiResponse({ status: 200, description: 'Submitted for review' })
@ApiResponse({ status: 400, description: 'Profile incomplete or already verified' })
submitVerification(@CurrentUser() user: JwtPayload) {
  return this.advocateService.submitVerification(user.sub);
}
```

---

## STEP 5 — Profile Fill Flow After Registration

After OTP verification, the advocate row exists with empty placeholder values. The advocate fills details via:

```
1. PUT /api/advocate/profile     → fill BCI professional fields
2. PUT /api/user/profile         → set preferred_language (bn/en)
3. POST /api/user/avatar         → upload profile photo → users.avatar_url
4. POST /api/advocate/documents  → upload Certificate of Practice PDF
5. POST /api/advocate/submit-verification → signal ready for admin
6. Admin: PUT /api/admin/advocates/:id/verify → approve/reject
```

**`PUT /api/advocate/profile` body (all fields optional — partial update):**
```json
{
  "name": "Anirban Sen",
  "barEnrolmentNumber": "WB/1234/2018",
  "stateBar": "West Bengal",
  "address": "12 Park Street, Kolkata 700016",
  "email": "contact@anirban.law",
  "practiceAreas": ["motor_vehicle", "consumer"],
  "courts": ["Calcutta HC", "Howrah District Court"],
  "languages": ["bn", "en"],
  "districts": ["howrah", "kolkata"]
}
```

**`PUT /api/user/profile` body:**
```json
{ "preferred_language": "bn" }
```

---

## STEP 6 — Data Routing: Which Field Goes Where

| Field | Table | Endpoint |
|---|---|---|
| `email` (login) | `users` | ❌ Not updatable |
| `email_verified` | `users` | Auto-set on OTP verify |
| `preferred_language` | `users` | `PUT /api/user/profile` |
| `avatar_url` | `users` | `POST /api/user/avatar` |
| `name` (CoP) | `advocates` | `PUT /api/advocate/profile` |
| `address` (CoP) | `advocates` | `PUT /api/advocate/profile` |
| `email` (CoP contact) | `advocates` | `PUT /api/advocate/profile` |
| `bar_enrolment_number` | `advocates` | `PUT /api/advocate/profile` |
| `state_bar` | `advocates` | `PUT /api/advocate/profile` |
| `practice_areas` | `advocates` | `PUT /api/advocate/profile` |
| `courts` | `advocates` | `PUT /api/advocate/profile` |
| `languages` | `advocates` | `PUT /api/advocate/profile` |
| `districts` | `advocates` | `PUT /api/advocate/profile` |
| `verification_status` | `advocates` | `PUT /api/admin/advocates/:id/verify` |
| CoP PDF | `advocate_verification_documents` | `POST /api/advocate/documents` |

---

## STEP 7 — GET Profile (Merged View)

`GET /api/advocate/me` already returns a JOIN of both tables:

```sql
SELECT a.id AS advocate_id, a.name, a.address, a.email AS advocate_email,
       a.bar_enrolment_number, a.state_bar,
       a.practice_areas, a.courts, a.languages, a.districts,
       a.verification_status, a.created_at, a.updated_at,
       u.email AS auth_email, u.preferred_language, u.avatar_url
FROM advocates a
JOIN users u ON u.id = a.user_id
WHERE a.user_id = $1
```

No changes needed. This is the "profile dashboard" view for the frontend.

---

## STEP 8 — Admin Queue (Already Done — No Changes)

- `GET /api/admin/advocates/pending` — list pending advocates + documents
- `PUT /api/admin/advocates/:id/verify` — `{ action: "approve" | "reject", reason? }`

Protected by `@Roles('admin')`. Admin user must be inserted directly in DB (no self-register):

```sql
INSERT INTO users (email, role, email_verified, preferred_language)
VALUES ('admin@legallink.com', 'admin', true, 'en');
```

Admin logs in via `POST /api/auth/login` → receives OTP → `POST /api/auth/verify-otp` → gets admin JWT.

---

## STEP 9 — Integration with Person 2

Share this query for advocate matching:

```sql
SELECT a.id, a.name, a.bar_enrolment_number,
       a.practice_areas, a.languages, a.districts,
       a.verification_status
FROM advocates a
WHERE a.verification_status = 'verified'
  AND a.practice_areas && ARRAY[$1]
  AND a.districts && ARRAY[$2]
  AND a.languages && ARRAY[$3]
LIMIT $4;
```

`&&` = array overlap, uses GIN indexes automatically.

**Shared contract:** Person 2 creates `consultations` rows (`POST /api/consultations`). You update status via `PUT /api/advocate/consultations/:id`. `consultations.advocate_id` references `advocates.id`.

---

## STEP 10 — Response Envelope (Already Configured)

All responses are auto-wrapped by `ResponseEnvelopeInterceptor`:

```json
{
  "success": true,
  "data": { ... },
  "meta": { "timestamp": "...", "requestId": "..." }
}
```

Just return plain objects from service methods — no manual wrapping.

---

## STEP 11 — Manual Test Cases (Run In Order)

Start server: `npm run start:dev` | Swagger: `http://localhost:3000/api/docs`

**Test 1 — Register Advocate**
```
POST /api/auth/register
Body: { "email": "testadv@gmail.com", "role": "advocate" }
Expected: 202, { expiresInSeconds: 600 }
Action: Check email inbox for OTP.
```

**Test 2 — Verify OTP (first login after register)**
```
POST /api/auth/verify-otp
Body: { "email": "testadv@gmail.com", "otp": "123456" }
Expected: 200, { accessToken: "eyJ...", user: { role: "advocate" } }
Action: Save accessToken. Check DB — advocates row must exist.
```

**Test 3 — Login (returning user)**
```
POST /api/auth/login
Body: { "email": "testadv@gmail.com" }
Expected: 202, { expiresInSeconds: 600 }
Then: POST /api/auth/verify-otp → new accessToken issued.
```

**Test 4 — Get Empty Profile**
```
GET /api/advocate/me
Header: Authorization: Bearer <accessToken>
Expected: 200, advocate row with empty strings, auth_email set.
```

**Test 5 — Set Preferred Language**
```
PUT /api/user/profile
Header: Authorization: Bearer <accessToken>
Body: { "preferred_language": "bn" }
Expected: 200, updated user profile.
```

**Test 6 — Fill Advocate Profile**
```
PUT /api/advocate/profile
Header: Authorization: Bearer <accessToken>
Body: {
  "name": "Anirban Sen",
  "barEnrolmentNumber": "WB/1234/2018",
  "stateBar": "West Bengal",
  "address": "12 Park Street Kolkata 700016",
  "email": "contact@anirban.law",
  "practiceAreas": ["motor_vehicle", "consumer"],
  "courts": ["Calcutta HC"],
  "languages": ["bn", "en"],
  "districts": ["howrah", "kolkata"]
}
Expected: 200, merged profile with all fields updated.
```

**Test 7 — Upload CoP Document**
```
POST /api/advocate/documents
Header: Authorization: Bearer <accessToken>
Form-data: document = <PDF file>
Expected: 201, { documentId, file_path (Cloudinary URL), file_type, uploaded_at }
```

**Test 8 — Submit for Verification**
```
POST /api/advocate/submit-verification
Header: Authorization: Bearer <accessToken>
Expected: 200, { advocateId, verificationStatus: "pending", message: "..." }
```

**Test 9 — Dashboard**
```
GET /api/advocate/dashboard
Header: Authorization: Bearer <accessToken>
Expected: 200, { verificationStatus, profileCompleteness: 100, consultationStats: { pending_count, ... } }
```

**Test 10 — List Consultations**
```
GET /api/advocate/consultations
Header: Authorization: Bearer <accessToken>
Expected: 200, [] (empty until Person 2 creates one)
```

**Test 11 — Accept Consultation**
```
PUT /api/advocate/consultations/<consultationId>
Header: Authorization: Bearer <accessToken>
Body: { "action": "accept" }
Expected: 200, { consultationId, status: "accepted" }
DB check: consultations.accepted_at must be set.
```

**Test 12 — Refresh Token**
```
POST /api/auth/refresh-token
(No body — refreshToken cookie sent automatically)
Expected: 200, { accessToken: "eyJ..." }
```

**Test 13 — Logout**
```
POST /api/auth/logout
Header: Authorization: Bearer <accessToken>
Expected: 200, { message: "Logged out successfully" }
DB check: refresh_token = NULL.
```

**Test 14 — Admin Verify Advocate**
```
(Seed admin first via SQL above)
POST /api/auth/login → { "email": "admin@legallink.com" }
POST /api/auth/verify-otp → get admin accessToken

GET /api/admin/advocates/pending (admin token)
PUT /api/admin/advocates/<advocateId>/verify
Body: { "action": "approve" }
Expected: 200, { verificationStatus: "verified" }
```

---

## STEP 12 — Final Checklist Before Team Handoff

- [ ] `RegisterDto` updated — only `email` + `role` (no `preferred_language`)
- [ ] `identity.service.ts` `register()` signature updated to remove `preferred_language` param
- [ ] `UpdateUserProfileDto` has `preferred_language` field
- [ ] `user.service.ts` `updateProfile()` handles `preferred_language` in SET clause
- [ ] `ConsultationActionDto` created at `src/advocate/dto/consultation-action.dto.ts`
- [ ] 5 new service methods added to `AdvocateService`
- [ ] 5 new controller methods added to `AdvocateController`
- [ ] Imports updated in `advocate.controller.ts` (`Param`, `HttpCode`)
- [ ] All 14 test cases pass in Swagger/Postman
- [ ] Admin seeded in DB via SQL INSERT
- [ ] Matching query shared with Person 2
- [ ] `.env.development` has: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

---

## Complete API Reference

| # | Method | Endpoint | Auth | Who |
|---|---|---|---|---|
| 1 | POST | `/api/auth/register` | None | Citizen + Advocate |
| 2 | POST | `/api/auth/verify-otp` | None | Citizen + Advocate |
| 3 | POST | `/api/auth/login` | None | Citizen + Advocate |
| 4 | POST | `/api/auth/refresh-token` | Cookie | Citizen + Advocate |
| 5 | POST | `/api/auth/logout` | Bearer | Citizen + Advocate |
| 6 | GET  | `/api/user/me` | Bearer | Citizen + Advocate |
| 7 | PUT  | `/api/user/profile` | Bearer | Citizen + Advocate |
| 8 | POST | `/api/user/avatar` | Bearer | Citizen + Advocate |
| 9 | GET  | `/api/advocate/me` | Bearer+advocate | Advocate |
| 10 | PUT  | `/api/advocate/profile` | Bearer+advocate | Advocate |
| 11 | GET  | `/api/advocate/documents` | Bearer+advocate | Advocate |
| 12 | POST | `/api/advocate/documents` | Bearer+advocate | Advocate |
| 13 | POST | `/api/advocate/submit-verification` | Bearer+advocate | Advocate |
| 14 | GET  | `/api/advocate/dashboard` | Bearer+advocate | Advocate |
| 15 | GET  | `/api/advocate/consultations` | Bearer+advocate | Advocate |
| 16 | GET  | `/api/advocate/consultations/:id` | Bearer+advocate | Advocate |
| 17 | PUT  | `/api/advocate/consultations/:id` | Bearer+advocate | Advocate |
| 18 | GET  | `/api/admin/advocates/pending` | Bearer+admin | Admin |
| 19 | PUT  | `/api/admin/advocates/:id/verify` | Bearer+admin | Admin |
