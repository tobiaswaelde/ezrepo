import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';

import { AuthService } from './auth.service.js';
import { Authenticated } from './authenticated.decorator.js';
import { AvatarService } from './avatar.service.js';
import { RemoteAvatarDto } from './dto/avatar.dto.js';
import { SetupDto } from './dto/setup.dto.js';
import { SignInDto } from './dto/sign-in.dto.js';
import { UpdatePasswordDto } from './dto/update-password.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import type { AuthResult, AuthenticatedUser } from './types.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  /**
   * Initialize AuthController with its required dependencies.
   *
   * @param auth - Service for local identity and bearer-token authentication.
   * @param avatars - Service for avatar validation, storage, and download.
   */
  constructor(
    private readonly auth: AuthService,
    private readonly avatars: AvatarService,
  ) {}

  /**
   * Verify local credentials and issue an access token with the current authentication version.
   *
   * @param body - Local username and password to authenticate.
   * @returns The authenticated identity and its newly signed access token.
   * @throws UnauthorizedException - Invalid credentials.
   */
  @Post('signin')
  @HttpCode(200)
  signIn(@Body() body: SignInDto) {
    return this.auth.signIn(body.username, body.password);
  }

  /**
   * Report whether the one-time first-user setup has completed.
   *
   * @returns Whether first-user setup has already completed.
   */
  @Get('setup-status')
  setupStatus(): Promise<{ initialized: boolean }> {
    return this.auth.getSetupStatus();
  }

  /**
   * Create and sign in the first system administrator exactly once.
   *
   * @param body - Credentials and optional profile names for the first administrator.
   * @returns The first administrator identity and its access token.
   * @throws ConflictException - The application is already initialized.
   */
  @Post('setup')
  @HttpCode(200)
  setup(@Body() body: SetupDto): Promise<AuthResult> {
    return this.auth.setup(body);
  }

  /**
   * Return the authenticated identity attached to the request.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @returns The safe identity of the authenticated user.
   */
  @Get('me')
  @Authenticated()
  me(@Req() request: { user: AuthenticatedUser }) {
    return request.user;
  }

  /**
   * Update the current user's personal identity after verifying login-name changes.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @param body - Profile values and current password when changing the login name.
   * @returns The updated safe user identity.
   * @throws UnauthorizedException - When the user no longer exists or a username change lacks valid credentials.
   */
  @Patch('me')
  @Authenticated()
  updateProfile(
    @Req() request: { user: AuthenticatedUser },
    @Body() body: UpdateProfileDto,
  ): Promise<AuthenticatedUser> {
    return this.auth.updateProfile(request.user.id, body);
  }

  /**
   * Store a normalized avatar for the current user.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @param file - Uploaded image bytes and declared MIME type, if provided.
   * @returns The authenticated identity with the updated avatar revision.
   * @throws BadRequestException - An avatar image is required.
   * @throws PayloadTooLargeException - When the supplied image exceeds 2 MB.
   */
  @Put('me/avatar')
  @Authenticated()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } },
  })
  async updateAvatar(
    @Req() request: { user: AuthenticatedUser },
    @UploadedFile() file?: { buffer: Buffer; mimetype: string },
  ): Promise<AuthenticatedUser> {
    if (!file) throw new BadRequestException('An avatar image is required.');
    const avatarUpdatedAt = await this.avatars.save(request.user.id, { data: file.buffer, mimeType: file.mimetype });
    return { ...request.user, avatarUpdatedAt };
  }

  /**
   * Remove the current user's avatar.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @returns The authenticated identity with its avatar removed.
   */
  @Delete('me/avatar')
  @Authenticated()
  async deleteAvatar(@Req() request: { user: AuthenticatedUser }): Promise<AuthenticatedUser> {
    await this.avatars.remove(request.user.id);
    return { ...request.user, avatarUpdatedAt: null };
  }

  /**
   * Download a protected remote image for client-side crop preview.
   *
   * @param body - Remote HTTPS URL of the image to preview.
   * @returns Validated remote image bytes as an HTTP stream for crop preview.
   * @throws BadGatewayException - When the remote image cannot be downloaded or the response fails validation at the
   * HTTP layer.
   * @throws BadRequestException - When the URL, redirect chain, resolved address, or image content violates import
   * restrictions.
   * @throws PayloadTooLargeException - When the remote image exceeds 2 MB.
   */
  @Post('me/avatar/remote-preview')
  @Authenticated()
  async previewRemoteAvatar(@Body() body: RemoteAvatarDto): Promise<StreamableFile> {
    const source = await this.avatars.download(body.url);
    return new StreamableFile(source.data, { type: source.mimeType });
  }

  /**
   * Acknowledge client-side removal of the bearer token.
   *
   * @returns No return value.
   */
  @Post('signout')
  @HttpCode(204)
  @Authenticated()
  signOut(): void {}

  /**
   * Replace the current password and return a token for the new authentication version.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @param body - Current password and the validated replacement password.
   * @returns The updated user identity and replacement access token.
   * @throws UnauthorizedException - Invalid credentials.
   */
  @Post('password')
  @Authenticated()
  updatePassword(@Req() request: { user: AuthenticatedUser }, @Body() body: UpdatePasswordDto): Promise<AuthResult> {
    return this.auth.updatePassword(request.user.id, body.currentPassword, body.newPassword);
  }
}
