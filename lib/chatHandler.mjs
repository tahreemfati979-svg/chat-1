import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  classifyQueryIntent,
  extractWeatherLocations,
  fetchLiveWebResults,
  fetchNewsFeed,
  fetchWeatherForLocation,
  formatNewsContext,
  formatWeatherContext,
  formatWebContext,
} from './liveServices.mjs';

export const PRIMARY_MODEL = 'gemini-3.1-flash-lite';
export const GROUNDED_MODEL = 'gemini-4-hydrogen';

// Remembers for 10 minutes if Gemini Search Grounding tool is unavailable/quota-limited (429/400/404)
let searchGroundingBlockedUntil = 0;

const BASE_SYSTEM_INSTRUCTION =
  'You are Lumina, a fast, accurate real-time AI assistant. Give clear, concise answers using clean Markdown when helpful. Never fabricate breaking news, live scores, weather conditions, dates, or URLs. When live data or search results are provided below, base your answer strictly on them, cite key sources naturally, and clearly mention if a live detail cannot be verified.';

const getWeatherDeclaration = {
  name: 'getWeatherForecast',
  description:
    'Get real-time current weather conditions and a 7-day forecast for a city, region, or country.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      locations: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          'One or more city/location names to check or compare (e.g. ["London"] or ["London", "Dubai"]).',
      },
    },
    required: ['locations'],
  },
};

export function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function parseApiError(err) {
  const errObj = err || {};
  const statusCode = typeof errObj.status === 'number' ? errObj.status : 0;
  const rawMessage = err instanceof Error ? err.message : String(err);
  const lower = rawMessage.toLowerCase();

  console.error('[Gemini API Error]', { statusCode, message: rawMessage.slice(0, 300) });

  if (
    statusCode === 429 ||
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate')
  ) {
    return {
      status: 429,
      code: 'RATE_LIMIT',
      message: 'Rate limit reached on the free Gemini tier. Please wait a moment and try again.',
    };
  }

  if (
    statusCode === 401 ||
    statusCode === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('permission_denied') ||
    lower.includes('401') ||
    lower.includes('403')
  ) {
    return {
      status: 403,
      code: 'AUTH_ERROR',
      message: 'Gemini API authentication failed. Please verify your GEMINI_API_KEY configuration.',
    };
  }

  if (statusCode === 404 || lower.includes('not_found') || lower.includes('404')) {
    return {
      status: 404,
      code: 'MODEL_NOT_FOUND',
      message: 'The configured AI model is currently unavailable. Please try again shortly.',
    };
  }

  if (statusCode === 400 || lower.includes('invalid_argument')) {
    return {
      status: 400,
      code: 'BAD_REQUEST',
      message: 'The request could not be processed. Please rephrase and try again.',
    };
  }

  if (
    lower.includes('network') ||
    lower.includes('fetch') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout')
  ) {
    return {
      status: 503,
      code: 'NETWORK_ERROR',
      message: 'Unable to reach the AI service due to a temporary network issue. Please retry.',
    };
  }

  return {
    status: 500,
    code: 'UPSTREAM_ERROR',
    message: 'Something went wrong while generating a response. Please try again.',
  };
}

async function withRetry(fn, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const isTransient =
        msg.includes('503') ||
        msg.includes('unavailable') ||
        msg.includes('etimedout') ||
        msg.includes('econnreset');

      if (!isTransient || attempt === maxRetries) {
        throw err;
      }

      const delayMs = 150 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export function validateMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }

  const sanitized = [];
  for (const item of raw.slice(-12)) {
    if (!item || typeof item !== 'object') return null;
    const role = item.role;
    const content = item.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
      return null;
    }
    const trimmed = content.trim();
    if (!trimmed) continue;
    sanitized.push({
      role,
      content: trimmed.slice(0, 32000),
    });
  }

  if (sanitized.length === 0 || sanitized[sanitized.length - 1].role !== 'user') {
    return null;
  }

  return sanitized;
}

function collectSourcesFromChunk(chunk, sourceMap) {
  const groundingChunks = chunk?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(groundingChunks)) return;
  for (const gc of groundingChunks) {
    const uri = gc?.web?.uri;
    const title = gc?.web?.title;
    if (typeof uri === 'string' && uri.startsWith('http') && !sourceMap.has(uri)) {
      sourceMap.set(uri, {
        title: typeof title === 'string' && title.trim() ? title.trim() : new URL(uri).hostname,
        url: uri,
      });
    }
  }
}

async function streamWithFallback(ai, contents, systemInstruction, useSearch, isAborted, onChunk, sourceMap) {
  const trySearchTool = useSearch && Date.now() >= searchGroundingBlockedUntil;

  let stream;
  if (trySearchTool) {
    try {
      stream = await withRetry(() =>
        ai.models.generateContentStream({
          model: PRIMARY_MODEL,
          contents,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            tools: [{ googleSearch: {} }],
          },
        })
      );
    } catch (searchErr) {
      const parsed = parseApiError(searchErr);
      if (parsed.status === 429 || parsed.status === 400 || parsed.status === 404) {
        // Cache Search Grounding unavailability for 10 min and fall back cleanly to our server-fetched live context
        searchGroundingBlockedUntil = Date.now() + 10 * 60 * 1000;
      } else {
        throw searchErr;
      }
    }
  }

  if (!stream) {
    try {
      stream = await withRetry(() =>
        ai.models.generateContentStream({
          model: PRIMARY_MODEL,
          contents,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          },
        })
      );
    } catch (primaryErr) {
      const parsed = parseApiError(primaryErr);
      if (parsed.status !== 404) {
        throw primaryErr;
      }
      stream = await withRetry(() =>
        ai.models.generateContentStream({
          model: GROUNDED_MODEL,
          contents,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        })
      );
    }
  }

  for await (const chunk of stream) {
    if (isAborted()) break;
    collectSourcesFromChunk(chunk, sourceMap);
    const text = chunk.text;
    if (text) {
      onChunk(text);
    }
  }
}

export async function runLiveChat({
  ai,
  messages,
  timezone = '',
  forceWebSearch = false,
  isAborted = () => false,
  emitEvent,
}) {
  const intent = classifyQueryIntent(messages, forceWebSearch);

  let weatherReports = [];
  let newsItems = [];
  let webResult = { snippets: [], sources: [], newsItems: [] };
  let weatherLookupAttempted = false;

  const weatherLocations = intent.isWeather
    ? extractWeatherLocations(intent.prompt, timezone)
    : [];
  const needsIndirectWeather = intent.isWeather && weatherLocations.length === 0;
  const shouldFetchWeb = !intent.newsQuery && (intent.needsGoogleSearch || needsIndirectWeather);

  if (intent.isWeather || intent.newsQuery || shouldFetchWeb) {
    if (intent.isWeather && intent.newsQuery) {
      emitEvent({ status: 'Fetching live weather & news...' });
    } else if (intent.isWeather) {
      emitEvent({ status: 'Fetching live weather forecast...' });
    } else if (intent.newsQuery) {
      emitEvent({ status: 'Fetching latest news & web updates...' });
    } else {
      emitEvent({ status: 'Searching live web sources...' });
    }
  }

  // Parallel live data fetchers (Open-Meteo + Google News RSS + Wikipedia/DuckDuckGo)
  const weatherPromise =
    weatherLocations.length > 0
      ? (async () => {
          weatherLookupAttempted = true;
          const results = await Promise.all(
            weatherLocations.slice(0, 3).map((loc) => fetchWeatherForLocation(loc))
          );
          return results.filter(Boolean);
        })()
      : Promise.resolve([]);

  const newsPromise = intent.newsQuery
    ? fetchNewsFeed({
        topic: intent.newsQuery.topic,
        query: intent.newsQuery.query,
        limit: 6,
      })
    : Promise.resolve([]);

  const webPromise = shouldFetchWeb
    ? fetchLiveWebResults(intent.prompt)
    : Promise.resolve({ snippets: [], sources: [], newsItems: [] });

  [weatherReports, newsItems, webResult] = await Promise.all([
    weatherPromise,
    newsPromise,
    webPromise,
  ]);

  if (isAborted()) return;

  if (weatherReports.length > 0) {
    emitEvent({ weather: weatherReports });
  }
  if (newsItems.length > 0) {
    emitEvent({ news: newsItems });
  }

  const nowStr = new Date().toUTCString();
  const contextSections = [`Current UTC time: ${nowStr}`];
  if (timezone) {
    contextSections.push(`User timezone: ${timezone}`);
  }
  if (weatherReports.length > 0) {
    contextSections.push(formatWeatherContext(weatherReports));
  } else if (weatherLookupAttempted) {
    contextSections.push(
      `Weather lookup notice: Live weather data could not be retrieved for "${weatherLocations.join(
        ', '
      )}". Do NOT fabricate temperatures or forecasts; clearly let the user know the location could not be resolved or the weather service is unavailable.`
    );
  }
  if (newsItems.length > 0) {
    contextSections.push(formatNewsContext(newsItems));
  }
  if (webResult.snippets.length > 0) {
    contextSections.push(formatWebContext(webResult));
  } else if (shouldFetchWeb && !needsIndirectWeather) {
    contextSections.push(
      'Live search notice: No real-time web results were returned for this query. Only state facts you are certain of, and clearly mention if current/live verification was unavailable.'
    );
  }

  const systemInstruction = `${BASE_SYSTEM_INSTRUCTION}\n\n${contextSections.join('\n\n')}`;
  const contents = messages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  const sourceMap = new Map();
  for (const s of webResult.sources) {
    if (s?.url && !sourceMap.has(s.url)) {
      sourceMap.set(s.url, s);
    }
  }

  // Indirect weather queries (e.g. "What is the weather in the capital of Japan?")
  // Use function calling on PRIMARY_MODEL backed by live web context!
  if (needsIndirectWeather) {
    try {
      const tools = [{ functionDeclarations: [getWeatherDeclaration] }];
      const turn1 = await withRetry(() =>
        ai.models.generateContent({
          model: PRIMARY_MODEL,
          contents,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            tools,
          },
        })
      );

      if (isAborted()) return;

      const previousContent = turn1.candidates?.[0]?.content;
      const weatherCalls = (turn1.functionCalls || []).filter(
        (fc) => fc.name === 'getWeatherForecast'
      );

      if (previousContent && weatherCalls.length > 0) {
        const requestedLocs = weatherCalls.flatMap((fc) =>
          Array.isArray(fc.args?.locations) ? fc.args.locations.map(String) : []
        );
        const fetched = (
          await Promise.all(requestedLocs.slice(0, 3).map((loc) => fetchWeatherForLocation(loc)))
        ).filter(Boolean);

        if (fetched.length > 0) {
          sourceMap.clear();
          emitEvent({ weather: fetched });
        }

        const functionResponses = weatherCalls.map((fc) => ({
          functionResponse: {
            id: fc.id,
            name: fc.name,
            response: {
              report:
                fetched.length > 0
                  ? formatWeatherContext(fetched)
                  : 'Weather data unavailable for the requested location.',
            },
          },
        }));

        const followUpContents = [
          ...contents,
          previousContent,
          { role: 'user', parts: functionResponses },
        ];

        const stream2 = await withRetry(() =>
          ai.models.generateContentStream({
            model: PRIMARY_MODEL,
            contents: followUpContents,
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              tools,
            },
          })
        );

        for await (const chunk of stream2) {
          if (isAborted()) break;
          const text = chunk.text;
          if (text) emitEvent({ text });
        }
      } else if (turn1.text) {
        emitEvent({ text: turn1.text });
      }
    } catch {
      await streamWithFallback(
        ai,
        contents,
        systemInstruction,
        false,
        isAborted,
        (text) => emitEvent({ text }),
        sourceMap
      );
    }
  } else {
    const useGoogleSearch = intent.needsGoogleSearch;

    await streamWithFallback(
      ai,
      contents,
      systemInstruction,
      useGoogleSearch,
      isAborted,
      (text) => emitEvent({ text }),
      sourceMap
    );
  }

  if (!isAborted()) {
    const sources = Array.from(sourceMap.values()).slice(0, 8);
    if (sources.length > 0) {
      emitEvent({ sources });
    }
  }
}
