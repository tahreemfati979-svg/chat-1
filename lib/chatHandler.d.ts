import type { GoogleGenAI } from '@google/genai';
import type { NewsItem, WeatherReport } from './liveServices.mjs';

export const PRIMARY_MODEL: string;
export const GROUNDED_MODEL: string;

export interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export interface GroundedSource {
  title: string;
  url: string;
}

export interface ChatStreamEvent {
  status?: string;
  weather?: WeatherReport[];
  news?: NewsItem[];
  sources?: GroundedSource[];
  text?: string;
}

export function getAiClient(): GoogleGenAI | null;
export function parseApiError(err: unknown): { status: number; message: string; code: string };
export function validateMessages(raw: unknown): ChatMessageInput[] | null;
export function runLiveChat(opts: {
  ai: GoogleGenAI;
  messages: ChatMessageInput[];
  timezone?: string;
  forceWebSearch?: boolean;
  isAborted?: () => boolean;
  emitEvent: (event: ChatStreamEvent) => void;
}): Promise<void>;
