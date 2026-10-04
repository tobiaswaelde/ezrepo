import { createHash } from 'node:crypto';

import type { OidcAccessDecision, OidcGroupsStatus, OidcRoleRules } from './oidc.types.js';

export const MAX_GROUPS_PER_TOKEN = 500;
export const MAX_GROUP_LENGTH = 512;
export const MAX_OBSERVED_GROUPS = 50;
const forbiddenSegments = new Set(['__proto__', 'constructor', 'prototype']);

type Claims = Record<string, unknown>;

/**
 * Determine whether a claim value is a traversable plain object.
 *
 * @param value - Candidate claim value.
 * @returns Whether the value can be traversed safely.
 */
function isPlainObject(value: unknown): value is Claims {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check an own property without invoking an overridden prototype method.
 *
 * @param value - Object to inspect.
 * @param key - Property name to find.
 * @returns Whether the object owns the property.
 */
function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Read an exact claim name or a safe dot-separated claim path.
 *
 * @param claims - Verified claims to inspect.
 * @param path - Exact name or dot-separated path.
 * @returns The lookup result without traversing unsafe prototype segments.
 */
export function readClaimPath(claims: Claims, path: string): { found: boolean; unsafe?: boolean; value?: unknown } {
  if (hasOwn(claims, path)) return { found: true, value: claims[path] };
  const segments = path.split('.');
  if (segments.some((segment) => !segment || forbiddenSegments.has(segment))) return { found: false, unsafe: true };
  let current: unknown = claims;
  for (const segment of segments) {
    if (!isPlainObject(current) || !hasOwn(current, segment)) return { found: false };
    current = current[segment];
  }
  return { found: true, value: current };
}

/**
 * Detect standard group-overage markers without following external claim sources.
 *
 * @param claims - Verified claims to inspect.
 * @param groupsClaim - Configured group claim name.
 * @returns Whether the provider indicated omitted groups.
 */
function indicatesOverage(claims: Claims, groupsClaim: string): boolean {
  if (claims.hasgroups === true || claims.hasgroups === 'true') return true;
  const names = claims._claim_names;
  if (!isPlainObject(names)) return false;
  return hasOwn(names, 'groups') || hasOwn(names, groupsClaim) || hasOwn(names, groupsClaim.split('.')[0] ?? '');
}

/**
 * Extract a bounded string-array group claim.
 *
 * @param claims - Verified ID-token or UserInfo claims.
 * @param groupsClaim - Configured exact claim name or dot path.
 * @returns A safe group list or a denial status.
 */
export function extractGroups(claims: Claims, groupsClaim: string): OidcGroupsStatus {
  if (indicatesOverage(claims, groupsClaim)) return { status: 'overage' };
  const claim = readClaimPath(claims, groupsClaim);
  if (claim.unsafe) return { reason: 'unsafe_claim_path', status: 'malformed' };
  if (!claim.found || claim.value === undefined) return { status: 'missing' };
  if (!Array.isArray(claim.value)) return { reason: 'not_an_array', status: 'malformed' };
  if (claim.value.length > MAX_GROUPS_PER_TOKEN) return { reason: 'too_many_groups', status: 'malformed' };
  const groups: string[] = [];
  for (const value of claim.value) {
    if (typeof value !== 'string') return { reason: 'non_string_entry', status: 'malformed' };
    if (!value || value.length > MAX_GROUP_LENGTH) return { reason: 'invalid_entry_length', status: 'malformed' };
    groups.push(value);
  }
  return { groups: [...new Set(groups)], status: 'ok' };
}

/**
 * Apply exact OIDC group mappings in descending privilege order.
 *
 * @param status - Validated group-claim extraction result.
 * @param rules - Configured role mappings and unmatched-user policy.
 * @returns An assigned role or an explicit denial reason.
 */
export function decideOidcAccess(status: OidcGroupsStatus, rules: OidcRoleRules): OidcAccessDecision {
  if (status.status === 'overage') return { ok: false, reason: 'groups_overage' };
  if (status.status === 'malformed') return { ok: false, reason: 'groups_malformed' };
  const groups = status.status === 'ok' ? status.groups : [];
  const available = new Set(groups);
  if (rules.systemAdministratorGroups.some((group) => available.has(group)))
    return { groups, ok: true, role: 'SYSTEM_ADMIN' };
  if (rules.managerGroups.some((group) => available.has(group))) return { groups, ok: true, role: 'MANAGER' };
  if (rules.viewerGroups.some((group) => available.has(group))) return { groups, ok: true, role: 'VIEWER' };
  if (rules.allowUnmatchedViewer) return { groups, ok: true, role: 'VIEWER' };
  return { ok: false, reason: status.status === 'missing' ? 'groups_missing' : 'no_matching_group' };
}

/**
 * Build a stable local username without using mutable or linkable profile claims.
 *
 * @param issuer - Verified identity-provider issuer.
 * @param subject - Verified provider subject.
 * @param attempt - Collision-extension attempt number.
 * @returns A deterministic internal username.
 */
export function deriveOidcUsername(issuer: string, subject: string, attempt = 0): string {
  const digest = createHash('sha256').update(`${issuer}\0${subject}`, 'utf8').digest('hex');
  return `oidc_${digest.slice(0, Math.min(24 + attempt * 4, 44))}`;
}

/**
 * Sanitize bounded group names before retaining them as administrator suggestions.
 *
 * @param groups - Successfully observed provider groups.
 * @returns A deduplicated and bounded suggestion list.
 */
export function sanitizeObservedGroups(groups: readonly string[]): string[] {
  return [
    ...new Set(groups.map((group) => group.trim()).filter((group) => group.length > 0 && group.length <= 128)),
  ].slice(-MAX_OBSERVED_GROUPS);
}
