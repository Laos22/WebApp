import { test } from 'node:test';
import assert from 'node:assert/strict';

const { googleAuthorizationOptions } = await import('../src/routes/authRoutes.js');

test('Google OAuth requests an offline refresh token using Passport option names', () => {
  assert.equal(googleAuthorizationOptions.accessType, 'offline');
  assert.equal(googleAuthorizationOptions.prompt, 'consent');
  assert.ok(googleAuthorizationOptions.scope.includes('https://www.googleapis.com/auth/drive.file'));
  assert.equal(Object.hasOwn(googleAuthorizationOptions, 'access_type'), false);
});
