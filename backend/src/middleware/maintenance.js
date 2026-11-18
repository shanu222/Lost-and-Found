// Maintenance mode (Admin → Settings): the app shows a maintenance screen and
// the API refuses requests — except health, app config, sign-in for staff and
// everything an admin does.
import { settings } from '../services/settings.js';
import { verifyAccessToken } from '../services/tokens.js';

const ALWAYS = [/^\/health$/, /^\/meta\/app-config$/, /^\/auth\/admin\//, /^\/auth\/refresh$/, /^\/auth\/logout$/, /^\/files\//];

export async function maintenanceGate(req, res, next) {
  try {
    if (!(await settings()).maintenance_mode) return next();
    if (ALWAYS.some((re) => re.test(req.path))) return next();
    const header = req.get('authorization') || '';
    if (header.startsWith('Bearer ')) {
      try {
        if (verifyAccessToken(header.slice(7)).role === 'admin') return next();
      } catch {
        /* fall through */
      }
    }
    res.status(503).json({ error: { code: 'MAINTENANCE', message: (await settings()).maintenance_message } });
  } catch (err) {
    next(err);
  }
}
