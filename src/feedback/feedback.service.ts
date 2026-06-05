import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ModerationService } from '../moderation/moderation.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(
    private db: DatabaseService,
    private moderation: ModerationService,
  ) {}

  // ── POST /api/consultations/:id/feedback — citizen only ───────────────────
  async submitFeedback(userId: string, consultationId: string, dto: CreateFeedbackDto) {
    if (!Number.isInteger(dto.rating) || dto.rating < 1 || dto.rating > 5) {
      throw new BadRequestException('RATING_MUST_BE_INTEGER_1_TO_5');
    }
    if (dto.comment && dto.comment.length > 500) {
      throw new BadRequestException('COMMENT_TOO_LONG');
    }

    const consultResult = await this.db.query(
      `SELECT request_id, status, citizen_id, advocate_id
       FROM consultation_request WHERE request_id = $1`,
      [consultationId],
    );
    if (!consultResult.rows.length) throw new NotFoundException('CONSULTATION_NOT_FOUND');

    const consult = consultResult.rows[0];
    if (consult.citizen_id !== userId) throw new ForbiddenException('NOT_YOUR_CONSULTATION');
    if (consult.status !== 'closed') throw new BadRequestException('CONSULTATION_NOT_CLOSED');

    const existing = await this.db.query(
      `SELECT id FROM consultation_feedback WHERE consultation_id = $1`,
      [consultationId],
    );
    if (existing.rows.length) throw new ConflictException('FEEDBACK_ALREADY_SUBMITTED');

    // Rule-36 check — flagged comments are hidden from public view, not rejected
    let isVisible = true;
    if (dto.comment) {
      const modResult = this.moderation.check(dto.comment);
      if (modResult.status === 'flagged') isVisible = false;
    }

    const row = await this.db.query(
      `INSERT INTO consultation_feedback
         (consultation_id, citizen_id, advocate_id, rating, comment, is_visible)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, rating, comment, is_visible, created_at`,
      [consultationId, userId, consult.advocate_id, dto.rating, dto.comment ?? null, isVisible],
    );

    const fb = row.rows[0];
    return {
      feedbackId: fb.id,
      rating: fb.rating,
      comment: fb.comment,
      isVisible: fb.is_visible,
      createdAt: fb.created_at,
    };
  }

  // ── GET /api/advocates/:id/feedback — public ──────────────────────────────
  async getAdvocateFeedback(advocateId: string) {
    const stats = await this.db.query(
      `SELECT ROUND(AVG(rating)::numeric, 1) AS average_rating,
              COUNT(*)::int AS total_count
       FROM consultation_feedback
       WHERE advocate_id = $1 AND is_visible = true`,
      [advocateId],
    );

    const comments = await this.db.query(
      `SELECT cf.id, cf.rating, cf.comment, cf.created_at,
              COALESCE(u.name, 'Anonymous') AS citizen_name,
              u.avatar_url AS citizen_avatar_url
       FROM consultation_feedback cf
       LEFT JOIN users u ON u.id = cf.citizen_id
       WHERE cf.advocate_id = $1 AND cf.is_visible = true
       ORDER BY cf.created_at DESC
       LIMIT 5`,
      [advocateId],
    );

    const { average_rating, total_count } = stats.rows[0];
    return {
      averageRating: average_rating ? parseFloat(average_rating) : null,
      totalCount: total_count,
      reviews: comments.rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        citizenName: r.citizen_name,
        citizenAvatarUrl: r.citizen_avatar_url,
        createdAt: r.created_at,
      })),
    };
  }

  // ── GET /api/advocate/reviews — advocate's own all reviews (protected) ────
  async getMyReviews(userId: string) {
    const advocateResult = await this.db.query(
      `SELECT id FROM advocates WHERE user_id = $1`,
      [userId],
    );
    if (!advocateResult.rows.length) throw new NotFoundException('ADVOCATE_NOT_FOUND');
    const advocateId = advocateResult.rows[0].id;

    const stats = await this.db.query(
      `SELECT ROUND(AVG(rating)::numeric, 1) AS average_rating,
              COUNT(*)::int AS total_count,
              COUNT(*) FILTER (WHERE is_visible = false)::int AS hidden_count
       FROM consultation_feedback WHERE advocate_id = $1`,
      [advocateId],
    );

    const reviews = await this.db.query(
      `SELECT cf.id, cf.rating, cf.comment, cf.is_visible, cf.created_at,
              COALESCE(u.name, 'Anonymous') AS citizen_name,
              u.avatar_url AS citizen_avatar_url
       FROM consultation_feedback cf
       LEFT JOIN users u ON u.id = cf.citizen_id
       WHERE cf.advocate_id = $1
       ORDER BY cf.created_at DESC`,
      [advocateId],
    );

    const { average_rating, total_count, hidden_count } = stats.rows[0];
    return {
      averageRating: average_rating ? parseFloat(average_rating) : null,
      totalCount: total_count,
      hiddenCount: hidden_count,
      reviews: reviews.rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        isVisible: r.is_visible,
        citizenName: r.citizen_name,
        citizenAvatarUrl: r.citizen_avatar_url,
        createdAt: r.created_at,
      })),
    };
  }
}
