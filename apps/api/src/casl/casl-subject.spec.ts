import { CaslAction } from './casl-action.js';
import { CaslSubject } from './casl-subject.js';

describe('CASL authorization contract', () => {
  it('contains every planned protected ezRepo resource', () => {
    expect(Object.values(CaslSubject)).toEqual([
      'all',
      'User',
      'ProviderAccount',
      'Repository',
      'WorkflowRun',
      'Issue',
      'PullRequest',
      'NotificationChannel',
      'NotificationDelivery',
      'Settings',
    ]);
    expect(CaslAction.Manage).toBe('manage');
  });
});
