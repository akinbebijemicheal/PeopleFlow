export type ApiStatus = 'success' | 'failure';

export interface ApiResponseBody<T = unknown> {
  status: ApiStatus;
  responseCode: string;
  responseMessage?: string;
  details: T;
}
