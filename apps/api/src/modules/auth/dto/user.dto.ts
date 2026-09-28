import { ApiProperty } from '@nestjs/swagger';
import { filterCaslFields } from '@querry-kit/nest/casl';

import { CaslAction } from '../../../casl/casl-action.js';
import { CaslSubject } from '../../../casl/casl-subject.js';
import type { AppAbility } from '../../../casl/types.js';
import type { User } from '../../../generated/prisma/client.js';

export type UserWithAvatar = User & { avatar?: { updatedAt: Date } | null };

/** Public user representation without credential material. */
export class UserDto {
  @ApiProperty({ format: 'date-time', nullable: true })
  avatarUpdatedAt!: Date | null;
  @ApiProperty({ maxLength: 255, nullable: true })
  firstName!: string | null;
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ maxLength: 255, nullable: true })
  lastName!: string | null;
  @ApiProperty({ maxLength: 255 })
  username!: string;
  @ApiProperty({ enum: ['SYSTEM_ADMIN', 'VIEWER', 'MANAGER'] })
  role!: User['role'];
  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  /**
   * Convert a persisted user to a permission-filtered public representation.
   *
   * @param model - Loaded database record and relations required by the DTO mapping.
   * @param ability - Optional cASL ability used to restrict resource access or exposed fields.
   * @returns The explicit public DTO projected from the supplied record.
   */
  static fromModel(model: UserWithAvatar, ability?: AppAbility): UserDto {
    return filterCaslFields(
      {
        avatarUpdatedAt: model.avatar?.updatedAt ?? null,
        firstName: model.firstName,
        id: model.id,
        lastName: model.lastName,
        username: model.username,
        role: model.role,
        createdAt: model.createdAt,
        updatedAt: model.updatedAt,
      },
      CaslSubject.User,
      ability,
      { action: CaslAction.Read },
    );
  }
}
