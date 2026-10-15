/** Only these fixed messages cross the HTTP boundary; SDK errors can contain credentials. */
export class SandboxError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}

export function sandboxConflict(message: string): SandboxError {
  return new SandboxError('SANDBOX_CONFLICT', 409, message);
}

export function sandboxNotFound(): SandboxError {
  return new SandboxError('SANDBOX_NOT_FOUND', 404, 'Sandbox environment not found.');
}

export function sandboxInvalid(message: string): SandboxError {
  return new SandboxError('SANDBOX_INVALID_REQUEST', 400, message);
}
