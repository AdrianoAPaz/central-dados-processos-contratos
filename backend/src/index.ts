import 'express-async-errors';
import path from 'node:path';
import express from 'express';
import { env } from './env';

const app = express();

app.use(express.json());

app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// Em produção, o backend também serve o build do frontend (CLAUDE.md 1.2) —
// um processo só, uma porta só, exatamente como o deploy-guide.md espera.
if (env.nodeEnv === 'production') {
  const staticDir = path.join(__dirname, '..', 'public');
  app.use(express.static(staticDir));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  },
);

app.listen(env.port, () => {
  console.log(`[backend] rodando em http://localhost:${env.port} (${env.nodeEnv})`);
});
