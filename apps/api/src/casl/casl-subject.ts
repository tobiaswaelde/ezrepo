/** Resources protected by ezRepo authorization policies. */
export enum CaslSubject {
  All = 'all',
  User = 'User',
  ProviderAccount = 'ProviderAccount',
  Repository = 'Repository',
  WorkflowRun = 'WorkflowRun',
  Issue = 'Issue',
  PullRequest = 'PullRequest',
  NotificationChannel = 'NotificationChannel',
  NotificationDelivery = 'NotificationDelivery',
  Settings = 'Settings',
}
