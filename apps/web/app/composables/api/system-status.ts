import { io, type Socket } from 'socket.io-client';
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue';

import {
  systemStatusEvent,
  systemStatusSnapshotSchema,
  type ProviderSyncActivity,
  type SystemStatusSnapshot,
} from '../../types/api/system-status';
import { accessTokenStorageKey } from './api';

export type SystemStatusConnection = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED';

interface StatusProgress {
  current: number;
  total: number;
}

interface ServerToClientEvents {
  [systemStatusEvent]: (snapshot: unknown) => void;
}

/** Access the shared status snapshot without creating another Socket.IO connection. */
export function useSystemStatusState() {
  const connection = useState<SystemStatusConnection>('system-status-connection', () => 'CONNECTING');
  const snapshot = useState<SystemStatusSnapshot>('system-status-snapshot', () => ({
    activity: null,
    runningWorkflowCount: 0,
    updatedAt: '',
  }));
  const progress = computed(() => getSystemStatusProgress(snapshot.value.activity));
  return { connection, progress, snapshot };
}

/** Convert the configured HTTP API base URL to the Socket.IO status namespace URL. */
export function getSystemStatusSocketUrl(apiBaseUrl: string, browserOrigin: string): string {
  const url = new URL(apiBaseUrl, browserOrigin);
  url.pathname = url.pathname.replace(/\/api(?:\/v\d+)?\/?$/, '');
  url.search = '';
  url.hash = '';
  return `${url.toString().replace(/\/$/, '')}/status`;
}

/** Select the most precise progress counter available for a provider synchronization. */
export function getSystemStatusProgress(activity: ProviderSyncActivity | null): StatusProgress | null {
  if (!activity) return null;
  if (
    activity.phase === 'PROCESSING_WORKFLOWS' &&
    activity.workflowRunsCompleted !== null &&
    activity.workflowRunsTotal !== null
  ) {
    return { current: activity.workflowRunsCompleted, total: activity.workflowRunsTotal };
  }
  return { current: activity.repositoriesCompleted, total: activity.repositoriesTotal };
}

/** Connect the global layout to the authenticated, read-only API status channel. */
export function useSystemStatus() {
  const config = useRuntimeConfig();
  const { connection, progress, snapshot } = useSystemStatusState();
  const socket = shallowRef<Socket<ServerToClientEvents> | null>(null);

  onMounted(() => {
    const accessToken = window.localStorage.getItem(accessTokenStorageKey);
    if (!accessToken) {
      connection.value = 'DISCONNECTED';
      return;
    }

    const client = io(getSystemStatusSocketUrl(config.public.apiBaseUrl, window.location.origin), {
      auth: { token: accessToken },
      transports: ['websocket'],
    });
    socket.value = client;
    client.on('connect', () => {
      connection.value = 'CONNECTED';
    });
    client.on('connect_error', () => {
      connection.value = 'DISCONNECTED';
    });
    client.on('disconnect', () => {
      connection.value = 'DISCONNECTED';
    });
    client.on(systemStatusEvent, (value) => {
      const result = systemStatusSnapshotSchema.safeParse(value);
      if (result.success) snapshot.value = result.data;
    });
  });

  onBeforeUnmount(() => {
    socket.value?.disconnect();
    socket.value = null;
  });

  return { connection, progress, snapshot };
}
