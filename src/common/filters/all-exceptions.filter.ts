import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { ApiResponseBody } from '../dto/api-response.dto';

const PRISMA_ERROR_STATUS: Record<
  string,
  { status: HttpStatus; message: string }
> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    message: 'A record with this value already exists',
  },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Record not found' },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, responseMessage, details } = this.resolve(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        exception instanceof Error ? exception.stack : exception,
      );
    } else {
      this.logger.warn(`${status} ${responseMessage}`);
    }

    const body: ApiResponseBody = {
      status: 'failure',
      responseCode: String(status),
      responseMessage,
      details: details ?? null,
    };
    response.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: HttpStatus;
    responseMessage: string;
    details?: unknown;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { status, responseMessage: payload };
      }

      const { message } = payload as { message?: string | string[] };
      if (Array.isArray(message)) {
        return {
          status,
          responseMessage: 'Validation failed',
          details: message,
        };
      }
      return { status, responseMessage: message ?? exception.message };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = PRISMA_ERROR_STATUS[exception.code];
      if (mapped) {
        return { status: mapped.status, responseMessage: mapped.message };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      responseMessage: 'Internal server error',
    };
  }
}
