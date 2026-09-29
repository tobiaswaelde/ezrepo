import { validate } from 'class-validator';

import { DefaultDateTimeFormat } from '../../../generated/prisma/client.js';
import { UpdateApplicationSettingsDto } from './application-settings.dto.js';

describe('UpdateApplicationSettingsDto', () => {
  it('accepts a supported date format and bounded whole-day retention', async () => {
    const input = Object.assign(new UpdateApplicationSettingsDto(), {
      dateTimeFormat: DefaultDateTimeFormat.ISO,
      issueRetentionDays: 3650,
      pullRequestRetentionDays: 1,
      workflowRunRetentionDays: 3650,
    });

    await expect(validate(input)).resolves.toHaveLength(0);
  });

  it('rejects unsupported formats and invalid retention periods', async () => {
    const input = Object.assign(new UpdateApplicationSettingsDto(), {
      dateTimeFormat: 'CUSTOM',
      issueRetentionDays: 0,
      pullRequestRetentionDays: 3651,
      workflowRunRetentionDays: 0.5,
    });

    const errors = await validate(input);
    expect(errors.map((error) => error.property)).toEqual([
      'dateTimeFormat',
      'issueRetentionDays',
      'pullRequestRetentionDays',
      'workflowRunRetentionDays',
    ]);
  });
});
