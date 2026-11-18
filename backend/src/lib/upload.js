// Multipart uploads (images) held in memory, then processed by services/images.js.
// Text fields arrive as one JSON string in the `data` field and are validated with zod.
import multer from 'multer';
import { badRequest } from './errors.js';
import { parse } from './validate.js';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 8, fields: 10, fieldSize: 200 * 1024 },
  fileFilter: (_req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(badRequest('IMAGE_INVALID', 'Only images can be uploaded.')),
});

/** Parse and validate the JSON `data` field of a multipart request. */
export function multipartData(req, schema) {
  let raw = {};
  if (typeof req.body?.data === 'string') {
    try {
      raw = JSON.parse(req.body.data);
    } catch {
      throw badRequest('BAD_JSON', 'Malformed data field.');
    }
  } else if (req.body && typeof req.body === 'object') {
    raw = req.body;
  }
  return parse(schema, raw);
}

/** Files of one field name. */
export const filesOf = (req, field) => (req.files ?? []).filter((f) => f.fieldname === field);
