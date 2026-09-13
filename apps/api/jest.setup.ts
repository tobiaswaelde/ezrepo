import 'reflect-metadata';

process.env.NODE_ENV ??= 'test';
process.env.AUTH_JWT_SECRET ??= 'test-jwt-secret';
process.env.DATABASE_URL ??= 'postgresql://ezrepo:ezrepo@localhost:5432/ezrepo_test';
process.env.SHADOW_DATABASE_URL ??= 'postgresql://ezrepo:ezrepo@localhost:5432/ezrepo_shadow';
process.env.TOKEN_ENCRYPTION_KEY ??= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.WEB_PUSH_VAPID_PUBLIC_KEY ??= 'test-public-key';
process.env.WEB_PUSH_VAPID_PRIVATE_KEY ??= 'test-private-key';
process.env.WEB_PUSH_VAPID_SUBJECT ??= 'mailto:test@example.com';
