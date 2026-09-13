import { QueryDTO, type BaseDelegateTypeMap } from '@querry-kit/nest';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import type {
  NotificationChannelTypeMap,
  NotificationDeliveryTypeMap,
  NotificationRuleTypeMap,
} from '../notification-query.service.js';

class NotificationSearchQueryDto<TTypeMap extends BaseDelegateTypeMap> extends QueryDTO<TTypeMap> {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @Transform(({ value }: { value: string }) => value.trim())
  search?: string;
}

export class NotificationChannelQueryDto extends NotificationSearchQueryDto<NotificationChannelTypeMap> {}
export class NotificationRuleQueryDto extends NotificationSearchQueryDto<NotificationRuleTypeMap> {}
export class NotificationDeliveryQueryDto extends NotificationSearchQueryDto<NotificationDeliveryTypeMap> {}
