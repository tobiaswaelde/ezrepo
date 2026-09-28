import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

import { PoliciesGuard } from '../../casl/policies.guard.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

/**
 * Require a valid bearer token and make CASL policies available to an endpoint.
 *
 * @returns A composed decorator enabling JWT authentication, CASL policies, and bearer API documentation.
 */
export const Authenticated = () => applyDecorators(UseGuards(JwtAuthGuard, PoliciesGuard), ApiBearerAuth());
