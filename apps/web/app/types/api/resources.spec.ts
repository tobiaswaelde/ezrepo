import { describe, expect, it } from 'vitest';

import {
  createSetupFormSchema,
  createUpdatePasswordFormSchema,
  signInRequestSchema,
  updatePasswordRequestSchema,
  updateProfileRequestSchema,
} from './auth';
import { apiEndpoints } from './endpoints';
import { applicationSettingsSchema, providerOAuthFormSchema, providerPatFormSchema } from './resources';

describe('web API contracts', () => {
  it('validates local credential payloads before they are submitted', () => {
    expect(signInRequestSchema.safeParse({ password: 'secret', username: 'admin' }).success).toBe(true);
    expect(updatePasswordRequestSchema.safeParse({ currentPassword: 'secret', newPassword: 'short' }).success).toBe(
      false,
    );
  });

  it('validates first-run and password-change confirmations', () => {
    const setupSchema = createSetupFormSchema('mismatch');
    const passwordSchema = createUpdatePasswordFormSchema('mismatch');

    expect(
      setupSchema.safeParse({
        confirmPassword: 'secure-password',
        firstName: '',
        lastName: '',
        password: 'secure-password',
        username: 'admin',
      }).success,
    ).toBe(true);
    expect(
      setupSchema.safeParse({
        confirmPassword: 'different-password',
        firstName: '',
        lastName: '',
        password: 'secure-password',
        username: 'admin',
      }).success,
    ).toBe(false);
    expect(
      passwordSchema.safeParse({
        confirmPassword: 'different-password',
        currentPassword: 'current-password',
        newPassword: 'replacement-password',
      }).success,
    ).toBe(false);
  });

  it('validates trimmed personal profile fields', () => {
    expect(
      updateProfileRequestSchema.safeParse({
        currentPassword: '',
        firstName: ' Vera ',
        lastName: '',
        username: ' viewer ',
      }).success,
    ).toBe(true);
    expect(updateProfileRequestSchema.safeParse({ firstName: '', lastName: '', username: '' }).success).toBe(false);
  });

  it('keeps the Query Kit endpoint relative to the configured API version', () => {
    expect(apiEndpoints.workflowRuns).toBe('workflow-runs');
    expect(apiEndpoints.auth.setupStatus).toBe('/auth/setup-status');
    expect(apiEndpoints.settings).toEqual({ base: '/settings' });
  });

  it('validates the complete global settings payload', () => {
    expect(
      applicationSettingsSchema.safeParse({
        dateTimeFormat: 'ISO',
        issueRetentionDays: 1,
        pullRequestRetentionDays: 90,
        workflowRunRetentionDays: 3650,
      }).success,
    ).toBe(true);
    expect(
      applicationSettingsSchema.safeParse({
        dateTimeFormat: 'CUSTOM',
        issueRetentionDays: 0,
        pullRequestRetentionDays: 3651,
        workflowRunRetentionDays: 0,
      }).success,
    ).toBe(false);
  });

  it('requires a personal access token only for PAT provider forms', () => {
    expect(
      providerOAuthFormSchema.safeParse({
        baseUrl: 'https://github.example.test',
        displayName: 'GitHub',
        providerType: 'GITHUB',
      }).success,
    ).toBe(true);
    expect(providerPatFormSchema.safeParse({ displayName: 'GitHub', providerType: 'GITHUB' }).success).toBe(false);
  });

  it('requires a base URL when a Gitea personal access token is configured', () => {
    expect(
      providerPatFormSchema.safeParse({ accessToken: 'token', displayName: 'Gitea', providerType: 'GITEA' }).success,
    ).toBe(false);
    expect(
      providerPatFormSchema.safeParse({
        accessToken: 'token',
        baseUrl: 'https://gitea.example.test',
        displayName: 'Gitea',
        providerType: 'GITEA',
      }).success,
    ).toBe(true);
  });
});
