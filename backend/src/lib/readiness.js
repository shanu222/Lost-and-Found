// Start-up state, shared by index.js and the /api/health route.
// The HTTP server listens immediately; requests get 503 until the database is
// migrated, and /api/health explains what is still missing.
export const readiness = { ready: false, stage: 'starting', error: null, since: new Date() };
