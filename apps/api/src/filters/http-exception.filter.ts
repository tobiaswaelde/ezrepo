import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

/** Produces a stable response shape for unhandled HTTP and application errors. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  /**
   * Translate an exception into the stable HTTP error response.
   *
   * @param exception - Exception to translate into the public error contract.
   * @param host - Nest arguments host providing the HTTP response.
   * @returns No return value.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : undefined;
    const message =
      typeof payload === 'object' && payload && 'message' in payload ? payload.message : 'Internal server error';

    response.status(status).json({
      error: HttpStatus[status] ?? 'Error',
      message,
      statusCode: status,
    });
  }
}
