export class AbpError extends Error {
  constructor(
    readonly endpoint: string,
    readonly abpMessage: string,
    readonly details: string | null,
    readonly unAuthorizedRequest: boolean,
  ) {
    super(`${endpoint}: ${abpMessage}${details ? ` (${details})` : ''}`);
    this.name = 'AbpError';
  }
}
