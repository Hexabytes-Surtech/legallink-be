// Central registry of all Cloudinary folder paths.
// Always import from here — never hardcode paths in services.
export const CLOUDINARY_FOLDERS = {
  ROOT: 'legallink',
  AVATARS: 'legallink/avatars',
  ADVOCATE_DOCUMENTS: 'legallink/documents/advocate-verification',
  CITIZEN_DOCUMENTS: 'legallink/documents/citizen-matters',
  CHAT_ATTACHMENTS: 'legallink/chat-attachments',
} as const;
