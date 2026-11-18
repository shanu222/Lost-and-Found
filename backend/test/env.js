// Test environment. Point TEST_DATABASE_URL at a throwaway database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/foundback_test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-test-access-secret-0123456789';
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.HASH_PEPPER = 'test-pepper-test-pepper-test-pepper-0123456789';
process.env.OTP_DEV_ECHO = 'true';
process.env.RESEND_API_KEY = '';
process.env.GOOGLE_CLIENT_ID = '';
process.env.CORS_ORIGINS = 'http://localhost:5173';
// Test-only staff account created by bootstrapAdmin in global setup.
process.env.ADMIN_EMAIL = 'admin@test.foundback.invalid';
process.env.ADMIN_INITIAL_PASSWORD = 'Test-Only#Pass2026';
