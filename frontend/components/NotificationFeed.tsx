"use client";

import { Bookmark, BookmarkCheck, CalendarDays, ExternalLink } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NewsCategory =
  | '🏆 Final Result'
  | '🎫 Admit Card'
  | '📅 Exam Date'
  | '📢 Notification';

export interface RawNotificationItem {
  id?: string | number | null;
  exam_name?: string | null;
  update_type?: string | null;
  category?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  summary?: string | null;
  source_url?: string | null;
  site_name?: string | null;
  created_at?: string | null;
  content_hash?: string | null;
}

export interface NotificationItem {
  id: string;
  examTitle: string;
  category: NewsCategory;
  rawCategoryType: string;
  oldValue: string;
  newValue: string;
  summary: string;
  sourceUrl: string;
  siteName: string;
  agencyCode: string;
  createdAt: string;
  createdAtMs: number;
}

interface NotificationFeedProps {
  title: string;
  description: string;
  updates: NotificationItem[];
  emptyMessage: string;
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Category badge colour map — zero blues, indigos, or purples
// ---------------------------------------------------------------------------

const categoryStyles: Record<NewsCategory, string> = {
  '🏆 Final Result':
    'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300',
  '🎫 Admit Card':
    'border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300',
  '📅 Exam Date':
    'border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300',
  '📢 Notification':
    'border-zinc-200 bg-zinc-100 text-zinc-800 dark:border-zinc-800/50 dark:bg-zinc-900/30 dark:text-zinc-400',
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseDateToMs(value: string): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Derive a short agency code from the portal's site name, source URL, or exam
 * title. Extended to recognise additional known exam bodies.
 */
function deriveAgencyCode(siteName: string, sourceUrl: string, examTitle: string): string {
  const combined = `${siteName} ${sourceUrl} ${examTitle}`.toUpperCase();

  const knownCodes: Array<[string, string]> = [
    ['TNPSC', 'TNPSC'],
    ['UPSC', 'UPSC'],
    ['IBPS', 'IBPS'],
    ['BPSC', 'BPSC'],
    ['MPSC', 'MPSC'],
    ['RPSC', 'RPSC'],
    ['APPSC', 'APPSC'],
    ['KPSC', 'KPSC'],
    ['OPSC', 'OPSC'],
    ['JPSC', 'JPSC'],
    ['HPSC', 'HPSC'],
    ['PPSC', 'PPSC'],
    ['UKPSC', 'UKPSC'],
    ['NTA', 'NTA'],
    ['RRB', 'RRB'],
    ['NEET', 'NTA'],
    ['JEE', 'NTA'],
    ['SSC', 'SSC'],
    ['SEBI', 'SEBI'],
    ['RBI', 'RBI'],
    ['NABARD', 'NABARD'],
    ['SBI', 'SBI'],
    ['FCI', 'FCI'],
    ['DRDO', 'DRDO'],
    ['ISRO', 'ISRO'],
  ];

  for (const [keyword, code] of knownCodes) {
    if (combined.includes(keyword)) {
      return code;
    }
  }

  // Fall back: abbreviate the site name tokens into an acronym
  const tokens = siteName
    .split(/[\s\-_/]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length > 0) {
    return tokens
      .slice(0, 4)
      .map((t) => t[0]?.toUpperCase() ?? '')
      .join('');
  }

  return 'PORTAL';
}

/**
 * Client-side categorisation engine. Inspects the concatenated text of
 * update_type, category, exam_name, and summary to assign one of the five
 * standardised NewsCategory values.
 */
export function getCountdownInfo(text: string): { label: string; daysLeft: number } | null {
  const dateRegexes = [
    /\b(0?[1-9]|[12][0-9]|3[01])[-./](0?[1-9]|1[0-2])[-./](\d{4})\b/g,
    /\b(\d{4})-(0?[1-9]|1[0-2])-(0?[1-9]|[12][0-9]|3[01])\b/g,
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)(\d{4})\b/gi,
  ];

  for (const regex of dateRegexes) {
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      try {
        let parsedDate: Date | null = null;
        if (match[3] && match[3].length === 4) {
          const day = parseInt(match[1], 10);
          const month = parseInt(match[2], 10) - 1;
          const year = parseInt(match[3], 10);
          parsedDate = new Date(year, month, day);
        } else if (match[1] && match[1].length === 4) {
          const year = parseInt(match[1], 10);
          const month = parseInt(match[2], 10) - 1;
          const day = parseInt(match[3], 10);
          parsedDate = new Date(year, month, day);
        } else {
          parsedDate = new Date(match[0]);
        }

        if (parsedDate && !isNaN(parsedDate.getTime())) {
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          parsedDate.setHours(0, 0, 0, 0);
          
          const diffTime = parsedDate.getTime() - now.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          if (diffDays > 0) {
            return {
              label: `⏳ ${diffDays} Day${diffDays > 1 ? 's' : ''} Left`,
              daysLeft: diffDays
            };
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }
  return null;
}

export function classifyCategory(text: string): NewsCategory {
  const n = text.toLowerCase();

  if (n.includes('admit') || n.includes('call letter') || n.includes('hall ticket')) {
    return '🎫 Admit Card';
  }
  if (
    n.includes('result') ||
    n.includes('score') ||
    n.includes('merit') ||
    n.includes('selected')
  ) {
    return '🏆 Final Result';
  }
  if (
    n.includes('date') ||
    n.includes('schedule') ||
    n.includes('postpone') ||
    n.includes('reschedule')
  ) {
    return '📅 Exam Date';
  }

  return '📢 Notification';
}

/**
 * Normalise a raw API response object into the typed NotificationItem shape
 * used throughout the frontend.
 */
export function normalizeNotification(item: RawNotificationItem, index: number): NotificationItem {
  const examTitle = asText(item.exam_name) || 'Untitled Exam Update';
  const summary = asText(item.summary) || 'No summary was provided for this update.';
  const sourceUrl = asText(item.source_url);
  const siteName = asText(item.site_name) || 'Unknown Portal';
  const rawUpdateType = asText(item.update_type);
  const rawCategory = asText(item.category);
  const oldValue = asText(item.old_value);
  const newValue = asText(item.new_value);
  const createdAt = asText(item.created_at);
  const createdAtMs = parseDateToMs(createdAt);

  // Combine all text signals for the categorisation engine
  const category = classifyCategory(
    `${rawCategory} ${rawUpdateType} ${examTitle} ${summary}`,
  );

  const idSeed = asText(item.content_hash) || String(item.id ?? '');
  const id = idSeed || `${siteName}-${createdAt}-${index}`;
  const agencyCode = deriveAgencyCode(siteName, sourceUrl, examTitle);

  return {
    id,
    examTitle,
    category,
    rawCategoryType: rawCategory || rawUpdateType || category,
    oldValue,
    newValue,
    summary,
    sourceUrl,
    siteName,
    agencyCode,
    createdAt,
    createdAtMs,
  };
}

// ---------------------------------------------------------------------------
// Date formatter
// ---------------------------------------------------------------------------

function formatDate(value: string): string {
  const asMs = parseDateToMs(value);
  if (!asMs) {
    return 'Timestamp unavailable';
  }
  return new Date(asMs).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Empty state illustration
// ---------------------------------------------------------------------------

function EmptyStateIllustration({ message }: { message: string }) {
  return (
    <div className="empty-state animate-fade-in">
      <svg
        className="mx-auto mb-4 h-14 w-14 opacity-30"
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="8" y="12" width="48" height="40" rx="4" />
        <line x1="20" y1="24" x2="44" y2="24" />
        <line x1="20" y1="32" x2="38" y2="32" />
        <line x1="20" y1="40" x2="30" y2="40" />
      </svg>
      <p className="font-medium">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function NotificationFeed({
  title,
  description,
  updates,
  emptyMessage,
  pinnedIds,
  onTogglePin,
}: NotificationFeedProps) {
  return (
    <section className="surface-card p-5 sm:p-6">
      {/* Feed header */}
      <div className="pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <p className="muted-label">Intelligence Stream</p>
        <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>
      </div>

      {/* Feed items */}
      <div className="mt-5 space-y-4">
        {updates.length === 0 ? (
          <EmptyStateIllustration message={emptyMessage} />
        ) : (
          updates.map((item, idx) => {
            const isPinned = pinnedIds.includes(item.id);
            return (
              <article
                key={item.id}
                id={`notification-card-${item.id}`}
                className="surface-card surface-card-hover p-4 animate-fade-in-up"
                style={{ animationDelay: `${Math.min(idx * 0.04, 0.4)}s` }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Badges row */}
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {/* Portal / agency badge */}
                      <span className="badge-agency">
                        {item.agencyCode}
                      </span>
                      {/* Category chip */}
                      <span className={`badge-category ${categoryStyles[item.category]}`}>
                        {item.category}
                      </span>
                      {/* Countdown Timer Badge */}
                      {(() => {
                        const countdown = getCountdownInfo(`${item.examTitle} ${item.summary} ${item.newValue}`);
                        if (countdown) {
                          return (
                            <span className="inline-flex items-center gap-1 bg-red-100 text-red-800 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50 px-2.5 py-0.5 text-[10px] font-bold rounded-full">
                              {countdown.label}
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>

                    {/* Exam title */}
                    <h3 className="text-lg font-semibold leading-snug">{item.examTitle}</h3>

                    {/* Summary */}
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                      {item.summary}
                    </p>

                    {/* Metadata grid */}
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3">
                        <div className="muted-label">Category Type</div>
                        <div className="mt-1 text-sm font-medium">{item.rawCategoryType}</div>
                      </div>
                      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3">
                        <div className="muted-label">Portal</div>
                        <div className="mt-1 text-sm font-medium truncate">{item.siteName}</div>
                      </div>
                      {item.oldValue ? (
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3">
                          <div className="muted-label">Previous Value</div>
                          <div className="mt-1 text-sm">{item.oldValue}</div>
                        </div>
                      ) : null}
                      {item.newValue ? (
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3">
                          <div className="muted-label">Updated Value</div>
                          <div className="mt-1 text-sm">{item.newValue}</div>
                        </div>
                      ) : null}
                    </div>

                    {/* Footer: date + source link */}
                    <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-[var(--text-secondary)]">
                      <span className="inline-flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 flex-shrink-0" />
                        {formatDate(item.createdAt)}
                      </span>
                      {item.sourceUrl ? (
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-2 font-medium text-[var(--text-primary)] underline underline-offset-4 transition hover:text-[var(--accent)]"
                        >
                          <ExternalLink className="h-4 w-4 flex-shrink-0" />
                          View source document
                        </a>
                      ) : (
                        <span className="text-sm opacity-60">Source link unavailable</span>
                      )}
                    </div>
                  </div>

                  {/* Pin button */}
                  <button
                    type="button"
                    onClick={() => onTogglePin(item.id)}
                    className={`btn-pin ${isPinned ? 'btn-pin-active' : ''}`}
                    aria-label={isPinned ? 'Unpin alert' : 'Pin alert'}
                    title={isPinned ? 'Unpin alert' : 'Pin alert'}
                  >
                    {isPinned ? (
                      <BookmarkCheck className="h-4 w-4" />
                    ) : (
                      <Bookmark className="h-4 w-4" />
                    )}
                    {isPinned ? 'Pinned' : 'Pin'}
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
