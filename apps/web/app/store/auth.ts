import { defineStore } from 'pinia';
import { ref } from 'vue';

import { accessTokenStorageKey, useApi } from '~/composables/api/api';
import type {
  AuthResult,
  AuthenticatedUser,
  OidcExchangeResult,
  SetupRequest,
  UpdatePasswordRequest,
  UpdateProfileRequest,
} from '~/types/api/auth';

/** Manages local bearer-token persistence and the current authenticated user. */
export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null);
  const initialized = ref(false);
  const user = ref<AuthenticatedUser | null>(null);

  /** Restore a stored token and verify it through the current-user endpoint. */
  async function initialize(): Promise<void> {
    if (initialized.value) return;
    initialized.value = true;
    accessToken.value = import.meta.client ? window.localStorage.getItem(accessTokenStorageKey) : null;
    if (accessToken.value) await refresh();
  }

  /** Sign in with local credentials and persist the resulting bearer token. */
  async function signIn(username: string, password: string): Promise<void> {
    const response = await useApi().post<AuthResult>('/auth/signin', { password, username });
    setSession(response.data);
  }

  /** Create and persist the first administrator session. */
  async function setup(input: SetupRequest): Promise<void> {
    const response = await useApi().post<AuthResult>('/auth/setup', input);
    setSession(response.data);
  }

  /** Exchange a short-lived OIDC browser handoff for the normal bearer session. */
  async function exchangeOidcCode(code: string): Promise<string> {
    const response = await useApi().post<OidcExchangeResult>('/auth/oidc/exchange', { code });
    setSession(response.data);
    return response.data.returnTo;
  }

  /** Refresh the current user and clear an expired or invalid local session. */
  async function refresh(): Promise<void> {
    try {
      user.value = (await useApi().get<AuthenticatedUser>('/auth/me')).data;
    } catch {
      clearSession();
    }
  }

  /** Sign out locally even if the API is temporarily unreachable. */
  async function signOut(): Promise<void> {
    try {
      await useApi().post('/auth/signout');
    } finally {
      clearSession();
    }
  }

  /** Replace the current safe user after a personal profile mutation. */
  function updateUser(updatedUser: AuthenticatedUser): void {
    user.value = updatedUser;
  }

  /** Persist personal identity fields and refresh every current-user surface. */
  async function updateProfile(input: UpdateProfileRequest): Promise<void> {
    user.value = (await useApi().patch<AuthenticatedUser>('/auth/me', input)).data;
  }

  /** Change the password and replace the now-invalid access token. */
  async function updatePassword(input: UpdatePasswordRequest): Promise<void> {
    const response = await useApi().post<AuthResult>('/auth/password', input);
    setSession(response.data);
  }

  function setSession(session: AuthResult): void {
    accessToken.value = session.accessToken;
    user.value = session.user;
    if (import.meta.client) window.localStorage.setItem(accessTokenStorageKey, session.accessToken);
  }

  function clearSession(): void {
    accessToken.value = null;
    user.value = null;
    if (import.meta.client) window.localStorage.removeItem(accessTokenStorageKey);
  }

  return {
    accessToken,
    clearSession,
    exchangeOidcCode,
    initialize,
    initialized,
    refresh,
    setup,
    signIn,
    signOut,
    updatePassword,
    updateProfile,
    updateUser,
    user,
  };
});
