import React from 'react';
import { CloudSun, Cpu, Globe, Newspaper, Trophy } from 'lucide-react';

interface EmptyStateProps {
  onSelectPrompt: (prompt: string) => void;
}

const STARTER_PROMPTS = [
  {
    icon: Newspaper,
    title: 'Breaking World News',
    prompt: 'What are the top breaking world news headlines today?',
  },
  {
    icon: CloudSun,
    title: '7-Day Weather & Compare',
    prompt: 'Compare the weather between London and Dubai with a 7-day forecast.',
  },
  {
    icon: Cpu,
    title: 'Tech & AI Updates',
    prompt: 'What are the latest AI and technology updates this week?',
  },
  {
    icon: Trophy,
    title: 'Live Sports Updates',
    prompt: 'What are the latest international sports scores and major upcoming fixtures?',
  },
];

export const EmptyState: React.FC<EmptyStateProps> = ({ onSelectPrompt }) => {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center px-4 py-10 text-center sm:py-16">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-blue-600 dark:border-slate-800 dark:bg-[#131A26] dark:text-blue-400">
        <Globe className="h-6 w-6" />
      </div>

      <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
        Real-Time Global Assistant
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        Ask about live weather forecasts, breaking world news, sports scores, tech releases, or anything else.
      </p>

      <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
        {STARTER_PROMPTS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.title}
              type="button"
              onClick={() => onSelectPrompt(item.prompt)}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-blue-500/50 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-800 dark:bg-[#131A26] dark:hover:border-blue-500/50 dark:hover:bg-[#172030]"
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {item.title}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {item.prompt}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
