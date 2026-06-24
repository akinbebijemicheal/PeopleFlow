import { ApiResponseBody } from '../../src/common/dto/api-response.dto';

/** supertest types res.body as `any`; cast it to our real envelope shape once, here. */
export function asResponseBody<T = unknown>(body: unknown): ApiResponseBody<T> {
  return body as ApiResponseBody<T>;
}
