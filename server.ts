import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRIMARY_MODEL,
  getAiClient,
  parseApiError,
  runLiveChat,
  validateMessages,
} from './lib/chatHandler.mjs';

interface ChatStreamEvent {
  status?: string;
  weather?: unknown[];
  news?: unknown[];
  sources?: Array<{ title: string; url: string }>;
  text?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, model: PRIMARY_MODEL });
  });

  app.post('/api/chat', async (req: Request, res: Response) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({
        code: 'MISSING_API_KEY',
        error: 'Gemini API key is not configured. Please add GEMINI_API_KEY in Settings > Secrets.',
      });
      return;
    }

    const messages = validateMessages(req.body?.messages);
    if (!messages) {
      res.status(400).json({
        code: 'INVALID_REQUEST',
        error: 'Please provide a valid non-empty message history ending with a user message.',
      });
      return;
    }

    const useStream = req.body?.stream !== false;
    const timezone = typeof req.body?.timezone === 'string' ? req.body.timezone.slice(0, 80) : '';
    const forceWebSearch = req.body?.forceWebSearch === true;

    if (!useStream) {
      try {
        let text = '';
        let weather: ChatStreamEvent['weather'];
        let news: ChatStreamEvent['news'];
        let sources: ChatStreamEvent['sources'];

        await runLiveChat({
          ai,
          messages,
          timezone,
          forceWebSearch,
          emitEvent: (ev: ChatStreamEvent) => {
            if (ev.text) text += ev.text;
            if (ev.weather) weather = ev.weather;
            if (ev.news) news = ev.news;
            if (ev.sources) sources = ev.sources;
          },
        });

        res.json({ text, weather, news, sources });
      } catch (err) {
        const parsed = parseApiError(err);
        res.status(parsed.status).json({ code: parsed.code, error: parsed.message });
      }
      return;
    }

    let clientClosed = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        clientClosed = true;
      }
    });

    res.socket?.setNoDelay(true);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    try {
      await runLiveChat({
        ai,
        messages,
        timezone,
        forceWebSearch,
        isAborted: () => clientClosed,
        emitEvent: (event: ChatStreamEvent) => {
          if (!clientClosed) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          }
        },
      });

      if (!clientClosed) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } catch (err) {
      const parsed = parseApiError(err);
      if (!clientClosed) {
        res.write(`data: ${JSON.stringify({ error: parsed.message, code: parsed.code })}\n\n`);
        res.end();
      }
    }
  });

  app.all('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({ code: 'NOT_FOUND', error: 'API endpoint not found.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
