"use client";

import { useState } from 'react';
import { Bookmark, BookmarkCheck, CalendarDays, ExternalLink, Search, FileText, Sparkles } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NewsCategory =
  | '🏆 Final Result'
  | '🎫 Admit Card'
  | '📅 Exam Date'
  | '📢 Notification';

export const CRM_STATUSES = [
  'Not Applied',
  'Applied — Awaiting Admit Card',
  'Admit Card Out!',
  'Exam Done',
] as const;

export type CrmStatus = typeof CRM_STATUSES[number];

export interface UserProfile {
  keywords: string;
}

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
  user_status?: string | null;
  fee?: string | null;
  vacancies?: string | null;
  last_date?: string | null;
}

export interface NotificationItem {
  id: string;
  numericId: number | null;
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
  userStatus: CrmStatus;
  fee: string;
  vacancies: string;
  lastDate: string;
}

export interface NotificationFeedProps {
  title: string;
  description: string;
  updates: NotificationItem[];
  emptyMessage: string;
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
  userProfile: UserProfile;
  apiBase: string;
  onStatusChange: (id: string, newStatus: CrmStatus) => void;
}

// ---------------------------------------------------------------------------
// Category badge colour map
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

const crmStatusStyles: Record<CrmStatus, string> = {
  'Not Applied': 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900/40 dark:text-zinc-400',
  'Applied — Awaiting Admit Card': 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  'Admit Card Out!': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  'Exam Done': 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseDateToMs(value: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deriveAgencyCode(siteName: string, sourceUrl: string, examTitle: string): string {
  const combined = `${siteName} ${sourceUrl} ${examTitle}`.toUpperCase();

  const knownCodes: Array<[string, string]> = [
    ['TNPSC', 'TNPSC'], ['UPSC', 'UPSC'], ['IBPS', 'IBPS'], ['BPSC', 'BPSC'],
    ['MPSC', 'MPSC'], ['RPSC', 'RPSC'], ['APPSC', 'APPSC'], ['KPSC', 'KPSC'],
    ['OPSC', 'OPSC'], ['JPSC', 'JPSC'], ['HPSC', 'HPSC'], ['PPSC', 'PPSC'],
    ['UKPSC', 'UKPSC'], ['NTA', 'NTA'], ['RRB', 'RRB'], ['NEET', 'NTA'],
    ['JEE', 'NTA'], ['SSC', 'SSC'], ['SEBI', 'SEBI'], ['RBI', 'RBI'],
    ['NABARD', 'NABARD'], ['SBI', 'SBI'], ['FCI', 'FCI'], ['DRDO', 'DRDO'],
    ['ISRO', 'ISRO'],
  ];

  for (const [keyword, code] of knownCodes) {
    if (combined.includes(keyword)) return code;
  }

  const tokens = siteName.split(/[\s\-_/]+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length > 0) {
    return tokens.slice(0, 4).map((t) => t[0]?.toUpperCase() ?? '').join('');
  }
  return 'PORTAL';
}

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
          parsedDate = new Date(parseInt(match[3], 10), parseInt(match[2], 10) - 1, parseInt(match[1], 10));
        } else if (match[1] && match[1].length === 4) {
          parsedDate = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
        } else {
          parsedDate = new Date(match[0]);
        }

        if (parsedDate && !isNaN(parsedDate.getTime())) {
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          parsedDate.setHours(0, 0, 0, 0);
          const diffDays = Math.ceil((parsedDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays > 0) {
            return { label: `⏳ ${diffDays} Day${diffDays > 1 ? 's' : ''} Left`, daysLeft: diffDays };
          }
        }
      } catch {
        // ignore parse errors
      }
    }
  }
  return null;
}

export function classifyCategory(text: string): NewsCategory {
  const n = text.toLowerCase();
  if (n.includes('admit') || n.includes('call letter') || n.includes('hall ticket')) return '🎫 Admit Card';
  if (n.includes('result') || n.includes('score') || n.includes('merit') || n.includes('selected')) return '🏆 Final Result';
  if (n.includes('date') || n.includes('schedule') || n.includes('postpone') || n.includes('reschedule')) return '📅 Exam Date';
  return '📢 Notification';
}

function isValidCrmStatus(value: string): value is CrmStatus {
  return (CRM_STATUSES as readonly string[]).includes(value);
}

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
  const rawUserStatus = asText(item.user_status);
  const userStatus: CrmStatus = isValidCrmStatus(rawUserStatus) ? rawUserStatus : 'Not Applied';

  const category = classifyCategory(`${rawCategory} ${rawUpdateType} ${examTitle} ${summary}`);
  const idSeed = asText(item.content_hash) || String(item.id ?? '');
  const id = idSeed || `${siteName}-${createdAt}-${index}`;
  const agencyCode = deriveAgencyCode(siteName, sourceUrl, examTitle);

  const rawNumeric = item.id;
  const numericId = typeof rawNumeric === 'number' ? rawNumeric
    : typeof rawNumeric === 'string' ? (parseInt(rawNumeric, 10) || null)
    : null;

  return {
    id, numericId, examTitle, category,
    rawCategoryType: rawCategory || rawUpdateType || category,
    oldValue, newValue, summary, sourceUrl, siteName, agencyCode,
    createdAt, createdAtMs, userStatus,
    fee: asText(item.fee),
    vacancies: asText(item.vacancies),
    lastDate: asText(item.last_date),
  };
}

// ---------------------------------------------------------------------------
// Smart eligibility matcher
// ---------------------------------------------------------------------------

function checkProfileMatch(examTitle: string, summary: string, keywords: string): boolean {
  if (!keywords.trim()) return false;
  const haystack = `${examTitle} ${summary}`.toLowerCase();
  return keywords
    .split(/[,\s]+/)
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 2)
    .some((k) => haystack.includes(k));
}

// ---------------------------------------------------------------------------
// Date formatter
// ---------------------------------------------------------------------------

function formatDate(value: string): string {
  const asMs = parseDateToMs(value);
  if (!asMs) return 'Timestamp unavailable';
  return new Date(asMs).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Google resource search URL builder
// ---------------------------------------------------------------------------

function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

// ---------------------------------------------------------------------------
// Empty state illustration
// ---------------------------------------------------------------------------

function EmptyStateIllustration({ message }: { message: string }) {
  return (
    <div className="empty-state animate-fade-in">
      <svg className="mx-auto mb-4 h-14 w-14 opacity-30" viewBox="0 0 64 64" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
// Super Card inner CRM dropdown — has its own local state for optimism
// ---------------------------------------------------------------------------

function CrmDropdown({
  itemId,
  numericId,
  initialStatus,
  apiBase,
  onStatusChange,
}: {
  itemId: string;
  numericId: number | null;
  initialStatus: CrmStatus;
  apiBase: string;
  onStatusChange: (id: string, newStatus: CrmStatus) => void;
}) {
  const [currentStatus, setCurrentStatus] = useState<CrmStatus>(initialStatus);
  const [saving, setSaving] = useState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as CrmStatus;
    if (!isValidCrmStatus(next)) return;

    // Optimistic update
    setCurrentStatus(next);
    onStatusChange(itemId, next);

    if (numericId === null) return; // Local-only item, no backend call

    setSaving(true);
    try {
      await fetch(`${apiBase}/api/update-status/${numericId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_status: next }),
      });
    } catch {
      // Silently handle — optimistic update already applied locally
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
        currentStatus === 'Not Applied' ? 'bg-zinc-400' :
        currentStatus === 'Applied — Awaiting Admit Card' ? 'bg-sky-500' :
        currentStatus === 'Admit Card Out!' ? 'bg-emerald-500' : 'bg-amber-500'
      }`} />
      <select
        id={`crm-status-${itemId}`}
        value={currentStatus}
        onChange={handleChange}
        disabled={saving}
        aria-label="Application status"
        className={`text-[11px] font-semibold rounded-lg border border-[var(--border)] px-2 py-1 outline-none cursor-pointer transition-all
          ${crmStatusStyles[currentStatus]}
          focus:ring-2 focus:ring-[var(--accent)]/30
          ${saving ? 'opacity-60 cursor-wait' : ''}`}
      >
        {CRM_STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
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
  userProfile,
  apiBase,
  onStatusChange,
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
            const isProfileMatch = checkProfileMatch(item.examTitle, item.summary, userProfile.keywords);
            const countdown = getCountdownInfo(
              `${item.examTitle} ${item.summary} ${item.newValue} ${item.lastDate}`
            );
            const hasTldr = item.fee || item.vacancies || item.lastDate;

            return (
              <article
                key={item.id}
                id={`notification-card-${item.id}`}
                className="surface-card surface-card-hover p-4 animate-fade-in-up"
                style={{ animationDelay: `${Math.min(idx * 0.04, 0.4)}s` }}
              >
                {/* ── Perfect Match Banner ── */}
                {isProfileMatch && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-300/60 bg-gradient-to-r from-emerald-50 to-teal-50 px-3 py-2 dark:border-emerald-700/40 dark:from-emerald-950/30 dark:to-teal-950/30">
                    <Sparkles className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" style={{ animation: 'pulse-dot 1.8s ease-in-out infinite' }} />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                      ✦ Perfect Match for Your Profile
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Badges row */}
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="badge-agency">{item.agencyCode}</span>
                      <span className={`badge-category ${categoryStyles[item.category]}`}>
                        {item.category}
                      </span>
                      {countdown && (
                        <span className="inline-flex items-center gap-1 bg-red-100 text-red-800 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50 px-2.5 py-0.5 text-[10px] font-bold rounded-full">
                          {countdown.label}
                        </span>
                      )}
                    </div>

                    {/* Exam title */}
                    <h3 className="text-lg font-semibold leading-snug">{item.examTitle}</h3>

                    {/* Summary */}
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{item.summary}</p>

                    {/* ── TL;DR Metadata Block ── */}
                    {hasTldr && (
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-2.5">
                        {item.fee && (
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <span className="muted-label">Fee</span>
                            <span className="font-semibold text-[var(--text-primary)]">{item.fee}</span>
                          </div>
                        )}
                        {item.vacancies && (
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <span className="muted-label">Vacancies</span>
                            <span className="font-semibold text-[var(--text-primary)]">{item.vacancies} Posts</span>
                          </div>
                        )}
                        {item.lastDate && (
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <span className="muted-label">Last Date</span>
                            <span className="font-semibold text-red-600 dark:text-red-400">{item.lastDate}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── CRM Status Dropdown ── */}
                    <div className="mt-3">
                      <CrmDropdown
                        itemId={item.id}
                        numericId={item.numericId}
                        initialStatus={item.userStatus}
                        apiBase={apiBase}
                        onStatusChange={onStatusChange}
                      />
                    </div>

                    {/* Footer: date + source links + resource finder */}
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[var(--text-secondary)]">
                      <span className="inline-flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 flex-shrink-0" />
                        {formatDate(item.createdAt)}
                      </span>

                      {item.sourceUrl ? (
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)] underline underline-offset-4 transition hover:text-[var(--accent)]"
                        >
                          <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                          Official Portal
                        </a>
                      ) : (
                        <span className="text-sm opacity-60">Source link unavailable</span>
                      )}

                      {/* ── Resource Finder ── */}
                      <a
                        href={googleSearchUrl(`${item.examTitle} Syllabus PDF 2026`)}
                        target="_blank"
                        rel="noreferrer noopener"
                        title="Find Syllabus PDF"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        <FileText className="h-3 w-3" />
                        Syllabus PDF
                      </a>
                      <a
                        href={googleSearchUrl(`${item.examTitle} Previous Year Question Papers 2023 2024 2025`)}
                        target="_blank"
                        rel="noreferrer noopener"
                        title="Find Past Papers"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        <Search className="h-3 w-3" />
                        Past 3 Yrs Papers
                      </a>
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
                    {isPinned ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
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
