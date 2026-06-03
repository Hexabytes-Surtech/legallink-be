import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import { Readable } from 'stream';

@Injectable()
export class CloudinaryService {
  // folder  – Cloudinary folder path, e.g. 'legallink/avatars'
  // publicId – optional; if omitted Cloudinary auto-generates one
  uploadFile(
    file: Express.Multer.File,
    folder: string,
    publicId?: string,
  ): Promise<UploadApiResponse | UploadApiErrorResponse> {
    return new Promise((resolve, reject) => {
      const upload = cloudinary.uploader.upload_stream(
        {
          folder, // stores file inside this folder
          public_id: publicId, // optional stable ID (e.g. userId for avatars)
          resource_type: 'auto', // handles images, PDFs, and other file types
        },
        (error, result) => {
          if (error) return reject(error);
          if (result) {
            resolve(result);
          } else {
            reject(new Error('Upload failed: result is undefined'));
          }
        },
      );

      // Stream the in-memory buffer to Cloudinary (no temp files)
      Readable.from(file.buffer).pipe(upload);
    });
  }

  /**
   * Build a delivery URL for an uploaded avatar that crops from the PRISTINE master
   * (no client-side re-encode) and serves an auto-format, auto-quality variant.
   *
   * `crop` is the pixel rectangle (in the original image's coordinates) the user
   * selected. We crop on Cloudinary's CDN instead of on a <canvas>, so the stored
   * master keeps its original quality and the displayed image stays sharp.
   */
  buildAvatarUrl(
    uploaded: UploadApiResponse,
    crop?: { x: number; y: number; width: number; height: number },
  ): string {
    const transformation: Record<string, unknown>[] = [];

    if (crop && crop.width > 0 && crop.height > 0) {
      transformation.push({
        crop: 'crop',
        x: Math.max(0, Math.round(crop.x)),
        y: Math.max(0, Math.round(crop.y)),
        width: Math.round(crop.width),
        height: Math.round(crop.height),
      });
    }

    // Bound the longest side so a huge phone photo doesn't ship multi-MB, while
    // staying large enough that the enlarged viewer is crisp. Then serve AVIF/WebP
    // at near-lossless auto quality.
    transformation.push({ width: 2048, height: 2048, crop: 'limit' });
    transformation.push({ fetch_format: 'auto', quality: 'auto:best' });

    return cloudinary.url(uploaded.public_id, {
      resource_type: uploaded.resource_type || 'image',
      type: uploaded.type || 'upload',
      version: uploaded.version,
      secure: true,
      transformation,
    });
  }
}
