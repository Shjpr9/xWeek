import express from 'express';

export const app = express();

app.use(express.json());

app.get('/api/hello', (_req, res) => {
  res.json({ message: 'hello from xWeek server' });
});
