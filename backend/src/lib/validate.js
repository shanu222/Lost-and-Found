// zod helpers: validate body/query/params and turn failures into the standard
// API error format.
import { z } from 'zod';
import { badRequest } from './errors.js';

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'VALIDATION_FAILED',
      'Some fields are invalid.',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

/** Express middleware: `validate({ body: schema, query: schema })`. */
export const validate = (schemas) => (req, _res, next) => {
  try {
    if (schemas.body) req.body = parse(schemas.body, req.body ?? {});
    // Express 5 makes req.query a getter, so store parsed values separately.
    if (schemas.query) req.validQuery = parse(schemas.query, req.query ?? {});
    if (schemas.params) req.validParams = parse(schemas.params, req.params ?? {});
    next();
  } catch (err) {
    next(err);
  }
};

export const countryCode = z
  .string()
  .trim()
  .length(2)
  .transform((s) => s.toUpperCase())
  .refine((s) => /^[A-Z]{2}$/.test(s), 'Must be an ISO 3166 alpha-2 code');
export const latitude = z.coerce.number().min(-90).max(90);
export const longitude = z.coerce.number().min(-180).max(180);
