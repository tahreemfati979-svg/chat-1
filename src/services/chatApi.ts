import type {
  GroundedSource,
  NewsItem,
  Role,
  WeatherReport,
} from '../types/chat';

export interface ApiMessagePayload {
  role: Role;
  content: string;
}

export interface StreamCallbacks {
  onStatus?: (status: string) => void;
  onWeather?: (weather: WeatherReport[]) => void;
  onNews?: (news: NewsItem[]) => void;
  onSources?: (sources: GroundedSource[]) => void;
  onChunk: (chunkText: string) => void;
}

export async function streamChatCompletion(
  messages: ApiMessagePayload[],
  callbacks: StreamCallbacks,
  options?: {
    signal?: AbortSignal;
    forceWebSearch?: boolean;
  }
): Promise<string> {
  let timezone = '';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    timezone = '';
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages,
      stream: true,
      timezone,
      forceWebSearch: Boolean(options?.forceWebSearch),
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    let errorMessage =
      response.status === 404
        ? 'Chat API endpoint not found (404). Make sure the server is running and try again.'
        : `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (data && typeof data.error === 'string') {
        errorMessage = data.error;
      }
    } catch {
      // Fallback to HTTP status message
    }
    throw new Error(errorMessage);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') || !response.body) {
    const data = await response.json();
    if (data?.error) {
      throw new Error(data.error);
    }
    if (Array.isArray(data?.weather)) callbacks.onWeather?.(data.weather);
    if (Array.isArray(data?.news)) callbacks.onNews?.(data.news);
    if (Array.isArray(data?.sources)) callbacks.onSources?.(data.sources);
    const text = typeof data?.text === 'string' ? data.text : '';
    if (text) callbacks.onChunk(text);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const lines = event.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === '[DONE]') continue;

        let parsed: {
          text?: string;
          status?: string;
          weather?: WeatherReport[];
          news?: NewsItem[];
          sources?: GroundedSource[];
          error?: string;
        };
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        if (parsed.error) {
          throw new Error(parsed.error);
        }

        if (typeof parsed.status === 'string') {
          callbacks.onStatus?.(parsed.status);
        }
        if (Array.isArray(parsed.weather) && parsed.weather.length > 0) {
          callbacks.onWeather?.(parsed.weather);
        }
        if (Array.isArray(parsed.news) && parsed.news.length > 0) {
          callbacks.onNews?.(parsed.news);
        }
        if (Array.isArray(parsed.sources) && parsed.sources.length > 0) {
          callbacks.onSources?.(parsed.sources);
        }
        if (typeof parsed.text === 'string' && parsed.text.length > 0) {
          fullText += parsed.text;
          callbacks.onChunk(parsed.text);
        }
      }
    }
  }

  return fullText;
}
