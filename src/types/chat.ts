export type Role = 'user' | 'assistant';

export type ThemeMode = 'dark' | 'light';

export type WeatherCategory =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'storm';

export interface DailyForecast {
  date: string;
  condition: string;
  category: WeatherCategory;
  tempMaxC: number;
  tempMinC: number;
  rainChance: number;
  windMaxKmh: number;
}

export interface WeatherReport {
  location: string;
  timezone: string;
  observedAt: string;
  current: {
    tempC: number;
    feelsLikeC: number;
    humidity: number;
    windKmh: number;
    precipitationMm: number;
    rainChanceToday: number;
    condition: string;
    category: WeatherCategory;
  };
  daily: DailyForecast[];
  sourceName: string;
  sourceUrl: string;
}

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
}

export interface GroundedSource {
  title: string;
  url: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  updatedAt?: number;
  weather?: WeatherReport[];
  news?: NewsItem[];
  sources?: GroundedSource[];
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatError {
  message: string;
  code?: string;
}
