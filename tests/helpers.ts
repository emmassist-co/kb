export function isSandboxListenError(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: string }).code === 'EPERM';
}

export function isSandboxTtyOrIpcError(output: string): boolean {
  return /listen EPERM: operation not permitted/.test(output);
}
