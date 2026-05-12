import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CLOUDINARY_FOLDERS } from '../cloudinary/cloudinary.folders';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';

@Injectable()
export class UserService {
  constructor(
    private db: DatabaseService,
    private cloudinaryService: CloudinaryService,
  ) {}

  // ── GET /api/user/me ───────────────────────────────────────────────────
  async getMe(userId: string) {
    return this.getSafeUser(userId);
  }

  // ── API 5 — PUT /api/user/profile ─────────────────────────────────────
  async updateProfile(userId: string, dto: UpdateUserProfileDto) {
    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (dto.phone !== undefined) {
      setClauses.push(`phone = $${paramIndex++}`);
      params.push(dto.phone);
    }
    if (dto.preferred_language !== undefined) {
      setClauses.push(`preferred_language = $${paramIndex++}`);
      params.push(dto.preferred_language);
    }

    if (setClauses.length === 0) {
      return this.getSafeUser(userId);
    }

    setClauses.push(`updated_at = now()`);
    params.push(userId);

    await this.db.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      params,
    );

    return this.getSafeUser(userId);
  }

  // ── API 6 — POST /api/user/avatar ─────────────────────────────────────
  async uploadAvatar(userId: string, file: Express.Multer.File) {
    const uploaded = await this.cloudinaryService.uploadFile(
      file,
      CLOUDINARY_FOLDERS.AVATARS,
      userId,
    );
    const avatarUrl = (uploaded as any).secure_url;

    await this.db.query(
      `UPDATE users SET avatar_url = $1, updated_at = now() WHERE id = $2`,
      [avatarUrl, userId],
    );

    return { avatar_url: avatarUrl };
  }

  // ── Private: return user without sensitive fields ─────────────────────
  private async getSafeUser(userId: string) {
    const result = await this.db.query(
      `SELECT id, email, email_verified, role, phone, preferred_language, avatar_url, created_at, updated_at
       FROM users WHERE id = $1`,
      [userId],
    );
    if (!result.rows.length) throw new NotFoundException('User not found');
    return result.rows[0];
  }
}
