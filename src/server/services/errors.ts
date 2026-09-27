import type { ZodError } from 'zod';

export class NotFoundError extends Error {
  override name = 'NotFoundError' as const;
  constructor(message: string) {
    super(message);
  }
}

export class ValidationError extends Error {
  override name = 'ValidationError' as const;
  constructor(message: string) {
    super(message);
  }
}

export class ProviderError extends Error {
  override name = 'ProviderError' as const;
  constructor() {
    super('The assistant is temporarily unavailable. Please try again.');
  }
}

/** Conflict message must list the conflicting tasks so the user can decide. */
export class ConflictError extends Error {
  override name = 'ConflictError' as const;
  readonly conflicts: string[];
  constructor(message: string, conflicts: string[]) {
    super(message);
    this.conflicts = conflicts;
  }
}

/** Zod issues flattened to "field: message" lines — zod v4 messages don't name the field. */
export function zodToMessage(error: ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
}
