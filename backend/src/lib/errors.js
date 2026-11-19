// Consistent API error format:
//   { "error": { "code": "COUNTRY_MISMATCH", "message": "…", "details": {…}? } }
// `code` is stable and machine-readable; the frontend maps it to a translated
// message (errors.<code> in the locale files), `message` is an English fallback.
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new ApiError(400, code, message, details);
export const unauthorized = (message = 'Please sign in.') => new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (code = 'FORBIDDEN', message = 'You are not allowed to do this.', details) =>
  new ApiError(403, code, message, details);

export const notFound = (message = 'Not found.') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (code, message, details) => new ApiError(409, code, message, details);
export const tooMany = (message = 'Too many requests. Please try again later.') =>
  new ApiError(429, 'RATE_LIMITED', message);
