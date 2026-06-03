import { Injectable, NotFoundException } from '@nestjs/common';
import type { UploadApiResponse } from 'cloudinary';
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

    if (dto.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      params.push(dto.name);
    }
    if (dto.address !== undefined) {
      setClauses.push(`address = $${paramIndex++}`);
      params.push(dto.address);
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
  // The ORIGINAL image is uploaded untouched; the optional `crop` rectangle is
  // applied as a Cloudinary delivery transformation. No client-side canvas re-encode,
  // so quality is preserved (the master stays exactly as the user uploaded it).
  async uploadAvatar(
    userId: string,
    file: Express.Multer.File,
    crop?: { x: number; y: number; width: number; height: number },
  ) {
    const uploaded = (await this.cloudinaryService.uploadFile(
      file,
      CLOUDINARY_FOLDERS.AVATARS,
      userId,
    )) as UploadApiResponse;

    const avatarUrl = this.cloudinaryService.buildAvatarUrl(uploaded, crop);

    await this.db.query(
      `UPDATE users SET avatar_url = $1, updated_at = now() WHERE id = $2`,
      [avatarUrl, userId],
    );

    return { avatar_url: avatarUrl };
  }

  // ── Private: return user without sensitive fields ─────────────────────
  private async getSafeUser(userId: string) {
    const result = await this.db.query(
      `SELECT id, email, email_verified, role, name, address, preferred_language, avatar_url, created_at, updated_at
       FROM users WHERE id = $1`,
      [userId],
    );
    if (!result.rows.length) throw new NotFoundException('User not found');
    return result.rows[0];
  }
}
