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
}
