import { SetMetadata } from '@nestjs/common';

import type { AppAbility } from './types.js';

export const CHECK_POLICIES_KEY = 'ezrepo:check-policies';

/** A predicate that must allow the current request's resolved CASL ability. */
export type PolicyHandler = (ability: AppAbility) => boolean;

/**
 * Require every supplied policy predicate before an endpoint can execute.
 *
 * @param handlers - Policy predicates that must all pass for the endpoint.
 * @returns A decorator storing the required policy predicates as route metadata.
 */
export const CheckPolicies = (...handlers: PolicyHandler[]) => SetMetadata(CHECK_POLICIES_KEY, handlers);
