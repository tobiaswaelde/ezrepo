import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsUrl, MaxLength } from 'class-validator';

/** Browser Push API availability and current-user enrollment summary. */
export class BrowserPushStatusDto {
  @ApiProperty()
  available!: boolean;
  @ApiPropertyOptional()
  publicKey!: string | null;
  @ApiProperty()
  subscriptionCount!: number;
}

/** Browser PushSubscription payload registered for the authenticated user. */
export class RegisterBrowserPushSubscriptionDto {
  @ApiProperty({ format: 'uri' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(4096)
  endpoint!: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  keys!: { auth?: unknown; p256dh?: unknown };
}

/** Identifies one current-user browser subscription for removal. */
export class RemoveBrowserPushSubscriptionDto {
  @ApiProperty({ format: 'uri' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(4096)
  endpoint!: string;
}
