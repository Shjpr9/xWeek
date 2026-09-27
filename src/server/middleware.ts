import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { ConflictError, NotFoundError, ProviderError, ValidationError, zodToMessage } from './services/errors.js';

/** Maps typed service errors to HTTP status. Anything else: 500, no internals. */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
  } else if (err instanceof ProviderError) {
    res.status(502).json({ error: err.message });
  } else if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message, conflicts: err.conflicts });
  } else if (err instanceof ValidationError || err instanceof ZodError) {
    const message = err instanceof ZodError ? zodToMessage(err) : err.message;
    res.status(400).json({ error: message });
  } else if (err instanceof SyntaxError && 'body' in err) {
    // express.json() chokes on malformed JSON.
    res.status(400).json({ error: 'Malformed JSON body' });
  } else {
    console.error(err); // full detail in logs only
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** Validate req.body against a schema, 400 on failure. */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(zodToMessage(result.error));
  }
  return result.data;
}
