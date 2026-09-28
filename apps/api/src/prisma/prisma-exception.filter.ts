import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import { Prisma } from '../generated/prisma/client.js';

export interface MappedDatabaseException {
  error: string;
  message: string;
  status: HttpStatus;
}

/**
 * Convert a known Prisma request error to the stable public API error contract.
 *
 * @param exception - The Prisma error raised by the database client.
 * @returns The safe HTTP response properties for the exception.
 */
export function mapPrismaException(exception: Prisma.PrismaClientKnownRequestError): MappedDatabaseException {
  switch (exception.code) {
    case 'P2002':
      return {
        error: 'Conflict',
        message: 'A record with this value already exists.',
        status: HttpStatus.CONFLICT,
      };
    case 'P2003':
      return {
        error: 'Conflict',
        message: 'This record is still referenced by another resource.',
        status: HttpStatus.CONFLICT,
      };
    case 'P2025':
      return {
        error: 'Not found',
        message: 'The requested resource does not exist.',
        status: HttpStatus.NOT_FOUND,
      };
    default:
      return {
        error: 'Database error',
        message: 'The database request could not be completed.',
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      };
  }
}

/** Converts known Prisma request errors into safe HTTP responses. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  /**
   * Translate an exception into the stable HTTP error response.
   *
   * @param exception - Exception to translate into the public error contract.
   * @param host - Nest arguments host providing the HTTP response.
   * @returns No return value.
   */
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped = mapPrismaException(exception);

    response.status(mapped.status).json({
      error: mapped.error,
      message: mapped.message,
      statusCode: mapped.status,
    });
  }
}
