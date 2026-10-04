import { z } from 'zod';

/** Roles that can be returned for an authenticated ezRepo user. */
export const userRoles = ['SYSTEM_ADMIN', 'VIEWER', 'MANAGER'] as const;

/** Validate local sign-in credentials before submitting them to the API. */
export const signInRequestSchema = z.object({
  password: z.string().min(1),
  username: z.string().min(1).max(255),
});

/** Validate a password-change request before submitting it to the API. */
export const updatePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12).max(256),
});

/** Validate the first administrator form, including its client-only password confirmation. */
export const setupFormSchema = z.object({
  confirmPassword: z.string().min(1),
  firstName: z.string().trim().max(255),
  lastName: z.string().trim().max(255),
  password: z.string().min(12).max(256),
  username: z.string().trim().min(1).max(255),
});

/** Add a localized password-confirmation error to the first-run form schema. */
export function createSetupFormSchema(passwordMismatchMessage: string) {
  return setupFormSchema.refine((value) => value.password === value.confirmPassword, {
    message: passwordMismatchMessage,
    path: ['confirmPassword'],
  });
}

/** Validate the password settings form, including its client-only confirmation. */
export const updatePasswordFormSchema = updatePasswordRequestSchema.extend({ confirmPassword: z.string().min(1) });

/** Add a localized password-confirmation error to the password settings schema. */
export function createUpdatePasswordFormSchema(passwordMismatchMessage: string) {
  return updatePasswordFormSchema.refine((value) => value.newPassword === value.confirmPassword, {
    message: passwordMismatchMessage,
    path: ['confirmPassword'],
  });
}

/** Validate editable personal identity fields before submitting them to the API. */
export const updateProfileRequestSchema = z.object({
  currentPassword: z.string().optional(),
  firstName: z.string().trim().max(255),
  lastName: z.string().trim().max(255),
  username: z.string().trim().min(1).max(255),
});

/** Local sign-in request payload. */
export type SignInRequest = z.infer<typeof signInRequestSchema>;

/** First-run administrator form state. */
export type SetupForm = z.infer<typeof setupFormSchema>;

/** Password-change request payload. */
export type UpdatePasswordRequest = z.infer<typeof updatePasswordRequestSchema>;

/** Password settings form state. */
export type UpdatePasswordForm = z.infer<typeof updatePasswordFormSchema>;

/** One-time first-administrator request accepted by the API. */
export interface SetupRequest {
  firstName?: string;
  lastName?: string;
  password: string;
  username: string;
}

/** Public first-run initialization state. */
export interface SetupStatus {
  initialized: boolean;
}

/** Browser form state validated before a personal profile update. */
export type UpdateProfileForm = z.infer<typeof updateProfileRequestSchema>;

/** Current-user profile update accepted by the API. */
export interface UpdateProfileRequest {
  currentPassword?: string;
  firstName: string | null;
  lastName: string | null;
  username: string;
}

/** The safe authenticated-user payload returned by ezRepo's auth endpoints. */
export interface AuthenticatedUser {
  authProvider: 'LOCAL' | 'OIDC';
  avatarUpdatedAt: string | null;
  firstName: string | null;
  id: string;
  lastName: string | null;
  role: (typeof userRoles)[number];
  username: string;
}

/** Successful local sign-in response. */
export interface AuthResult {
  accessToken: string;
  user: AuthenticatedUser;
}

export interface OidcStatus {
  enabled: boolean;
  providerName?: string;
}

export interface OidcConfig {
  allowHttpIssuer: boolean;
  allowUnmatchedViewer: boolean;
  callbackUrl: string;
  clientId: string | null;
  clientSecretConfigured: boolean;
  configRevision: number;
  enabled: boolean;
  groupsClaim: string;
  issuer: string | null;
  managerGroups: string[];
  observedGroups: string[];
  providerName: string | null;
  scopes: string[];
  secretDecryptable: boolean;
  systemAdministratorGroups: string[];
  updatedAt: string;
  viewerGroups: string[];
}

export interface UpdateOidcConfig extends Omit<
  OidcConfig,
  'callbackUrl' | 'clientSecretConfigured' | 'configRevision' | 'observedGroups' | 'secretDecryptable' | 'updatedAt'
> {
  clientSecret?: string;
  clientSecretClear?: boolean;
}

export interface OidcCheckResult {
  code?: string;
  endpoints?: { authorization: boolean; jwks: boolean; token: boolean; userinfo: boolean };
  idTokenAlgorithm?: string;
  issuer?: string;
  ok: boolean;
  tokenEndpointAuthenticationMethod?: 'client_secret_basic' | 'client_secret_post' | 'none';
  warnings?: string[];
}

export interface OidcExchangeResult extends AuthResult {
  returnTo: string;
}
