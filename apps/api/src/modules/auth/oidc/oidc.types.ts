import type { OidcConfig, UserRole } from '../../../generated/prisma/client.js';

export type OidcErrorCode =
  | 'oidc_not_configured'
  | 'oidc_invalid_request'
  | 'oidc_transaction_invalid'
  | 'oidc_provider_error'
  | 'oidc_token_invalid'
  | 'oidc_access_denied'
  | 'oidc_unavailable';

export type OidcGroupsStatus =
  | { groups: string[]; status: 'ok' }
  | { status: 'missing' }
  | { reason: string; status: 'malformed' }
  | { status: 'overage' };

export type OidcAccessDecision =
  | { groups: string[]; ok: true; role: UserRole }
  | { ok: false; reason: 'groups_missing' | 'groups_malformed' | 'groups_overage' | 'no_matching_group' };

export interface OidcRoleRules {
  allowUnmatchedViewer: boolean;
  managerGroups: string[];
  systemAdministratorGroups: string[];
  viewerGroups: string[];
}

export type OidcConfigRecord = OidcConfig;

export interface OidcCheckResult {
  code?: string;
  endpoints?: { authorization: boolean; jwks: boolean; token: boolean; userinfo: boolean };
  idTokenAlgorithm?: string;
  issuer?: string;
  ok: boolean;
  tokenEndpointAuthenticationMethod?: 'client_secret_basic' | 'client_secret_post' | 'none';
  warnings?: string[];
}
