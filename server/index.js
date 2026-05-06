import express from 'express';
import cors from 'cors';
import logsRouter from './routes/logs.js';
import certsRouter from './routes/certs.js';
import registryRouter from './routes/registry.js';
import historyRouter from './routes/history.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/logs', logsRouter);
app.use('/api/certs', certsRouter);
app.use('/api/registry', registryRouter);
app.use('/api/history', historyRouter);

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`DevOps Assistant API running on http://localhost:${PORT}`);
});
