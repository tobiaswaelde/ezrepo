import { computed, ref } from 'vue';

import { useEzRepoApi } from '~/composables/api/ezrepo-api';

/** Manage the authenticated user's PushSubscription for the current browser. */
export function useBrowserPush() {
  const api = useEzRepoApi();
  const available = ref(false);
  const currentDeviceEnabled = ref(false);
  const error = ref(false);
  const loading = ref(false);
  const publicKey = ref<string | null>(null);
  const subscriptionCount = ref(0);
  const supported = computed(
    () => import.meta.client && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  );

  async function registration(): Promise<ServiceWorkerRegistration> {
    return (
      (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js', { scope: '/' })
    );
  }

  /** Refresh server availability and the current browser's local subscription state. */
  async function refresh(): Promise<void> {
    error.value = false;
    try {
      const { data } = await api.browserPush.status();
      available.value = data.available;
      publicKey.value = data.publicKey;
      subscriptionCount.value = data.subscriptionCount;
      if (supported.value && available.value)
        currentDeviceEnabled.value = Boolean(await (await registration()).pushManager.getSubscription());
      else currentDeviceEnabled.value = false;
    } catch {
      error.value = true;
    }
  }

  /** Request permission and register the current browser under the current user. */
  async function enable(): Promise<void> {
    if (!supported.value || !available.value || !publicKey.value) return;
    loading.value = true;
    error.value = false;
    try {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('permission denied');
      const worker = await registration();
      const subscription =
        (await worker.pushManager.getSubscription()) ??
        (await worker.pushManager.subscribe({
          applicationServerKey: decodeBase64Url(publicKey.value),
          userVisibleOnly: true,
        }));
      await api.browserPush.register(subscription.toJSON());
      currentDeviceEnabled.value = true;
      await refresh();
    } catch {
      error.value = true;
    } finally {
      loading.value = false;
    }
  }

  /** Remove and unsubscribe the current browser without affecting the user's other devices. */
  async function disable(): Promise<void> {
    if (!supported.value) return;
    loading.value = true;
    error.value = false;
    try {
      const subscription = await (await registration()).pushManager.getSubscription();
      if (subscription) {
        await api.browserPush.remove(subscription.endpoint);
        await subscription.unsubscribe();
      }
      currentDeviceEnabled.value = false;
      await refresh();
    } catch {
      error.value = true;
    } finally {
      loading.value = false;
    }
  }

  return { available, currentDeviceEnabled, disable, enable, error, loading, refresh, subscriptionCount, supported };
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
