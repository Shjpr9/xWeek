import { Router } from 'express';
import type { Db } from '../db/connection.js';
import { getSettings, updateSettings } from '../services/settings.js';
import { settingsPatchSchema } from '../../shared/schemas.js';
import { parseBody } from '../middleware.js';

export function settingsRouter(db: Db): Router {
  const router = Router();

  router.get('/settings', (_req, res) => {
    res.json(getSettings(db));
  });

  router.put('/settings', (req, res) => {
    const patch = parseBody(settingsPatchSchema, req.body);
    res.json(updateSettings(db, patch));
  });

  return router;
}
