export class AbpError extends Error {
  constructor(
    readonly endpoint: string,
    readonly abpMessage: string,
    readonly details: string | null,
    readonly unAuthorizedRequest: boolean,
    readonly code: number | null = null,
    readonly httpStatus: number | null = null,
  ) {
    const codePart =
      code !== null || httpStatus !== null ? ` [code=${code ?? '-'} http=${httpStatus ?? '-'}]` : '';
    super(`${endpoint}: ${abpMessage}${details ? ` (${details})` : ''}${codePart}`);
    this.name = 'AbpError';
  }
}

const RATE_LIMIT_PATTERN = /too frequent|จองถี่เกินไป/i;
const COURT_CLOSED_PATTERN = /ปิดทำการ/;

export function isRateLimitError(error: unknown): boolean {
  return error instanceof AbpError && RATE_LIMIT_PATTERN.test(error.message);
}

export function isCourtClosedError(error: unknown): boolean {
  return error instanceof AbpError && COURT_CLOSED_PATTERN.test(error.message);
}
