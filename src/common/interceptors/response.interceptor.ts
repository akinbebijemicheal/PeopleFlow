import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponseBody } from '../dto/api-response.dto';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponseBody<T>
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponseBody<T>> {
    return next.handle().pipe(
      map((data) => ({
        status: 'success',
        responseCode: '00',
        details: data,
      })),
    );
  }
}
