"use client";

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Moon,
  Sun,
  Plus,
  LayoutGrid,
  Newspaper,
  Filter,
  CalendarRange,
  Trash2,
} from 'lucide-react';
import DashboardStats from '../components/DashboardStats';
import NotificationFeed, {
  NewsCategory,
  NotificationItem,
  RawNotificationItem,
  normalizeNotification,
} from '../components/NotificationFeed';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type ThemeMode = 'light' | 'dark';
type DashboardTab = 'stream' | 'dashboard';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
const THEME_KEY = 'govexam-theme-mode';
const PINNED_KEY = 'govexam-pinned-alerts';
const WATCHLIST_KEY = 'govexam-watchlist-portals';
const DASHBOARD_WINDOW_DAYS = 20;
const REFRESH_INTERVAL_MS = 45_000;

const CATEGORY_OPTIONS: Array<NewsCategory> = [
  'Exam Dates',
  'Admit Card Release',
  'Results',
  'Answer Key',
  'General Notification',
];

const categoryStyles: Record<NewsCategory, string> = {
  'Exam Dates':
    'border-[#E3D4B0] bg-[#F1E8D3] text-[#6B4E20] dark:border-[#4A3A1F] dark:bg-[#2A2112] dark:text-[#EBCF98]',
  'Admit Card Release':
    'border-[#C7DAD2] bg-[#E2ECE9] text-[#325246] dark:border-[#2C3D36] dark:bg-[#1A2420] dark:text-[#B7D1C5]',
  Results:
    'border-[#E5CCC2] bg-[#F2E6E2] text-[#724338] dark:border-[#4B2E26] dark:bg-[#2A1C18] dark:text-[#E5B8A9]',
  'Answer Key':
    'border-[#DCD4BC] bg-[#EEE8D8] text-[#5D5434] dark:border-[#3C3420] dark:bg-[#252214] dark:text-[#D9CC9E]',
  'General Notification':
    'border-[#DDD7CF] bg-[#EFEDEA] text-[#4D4640] dark:border-[#303030] dark:bg-[#1C1C1C] dark:text-[#CFC8BE]',
};

interface ActiveToast {
  id: string;
  examTitle: string;
  agencyCode: string;
  category: NewsCategory;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface ApiStats {
  // snake_case keys (database layer)
  total_alerts: number;
  total_sites: number;
  telegram_sent: number;
  last_sync: string | null;
  active_monitors: number;
  watchlist_count: number;
  // camelCase keys (also returned by /api/stats for frontend compatibility)
  totalAlerts?: number;
  activeMonitors?: number;
  lastSync?: string | null;
  totalSites?: number;
}

interface WatchlistPortal {
  id: string;
  websiteName: string;
  targetUrl: string;
  synced: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Returns true if the given Unix-ms timestamp falls within the last N days
 * from the current moment, inclusive of now.
 */
function isWithinLastDays(timestampMs: number, days: number): boolean {
  if (!timestampMs) {
    return false;
  }
  const nowMs = Date.now();
  const minAllowed = nowMs - days * 24 * 60 * 60 * 1000;
  return timestampMs >= minAllowed && timestampMs <= nowMs;
}

function formatRefreshLabel(isoTime: string | null): string {
  if (!isoTime) {
    return 'Waiting for first refresh';
  }
  const parsed = Date.parse(isoTime);
  if (!Number.isFinite(parsed)) {
    return 'Waiting for first refresh';
  }
  return new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Parse a raw stats payload, reading BOTH camelCase and snake_case keys so
 * neither convention causes "undefined / 0" regressions.
 */
function parseApiStats(payload: Record<string, unknown>, fallbackLength: number, fallbackPortalCount: number): ApiStats {
  const total_alerts =
    asNumber(payload.totalAlerts) ||
    asNumber(payload.total_alerts) ||
    fallbackLength;

  const active_monitors =
    asNumber(payload.activeMonitors) ||
    asNumber(payload.active_monitors) ||
    fallbackPortalCount;

  const total_sites =
    asNumber(payload.totalSites) ||
    asNumber(payload.total_sites) ||
    fallbackPortalCount;

  const telegram_sent =
    asNumber(payload.telegramSent) ||
    asNumber(payload.telegram_sent);

  const watchlist_count =
    asNumber(payload.watchlistCount) ||
    asNumber(payload.watchlist_count);

  const last_sync =
    asText(payload.lastSync) ||
    asText(payload.last_sync) ||
    null;

  return {
    total_alerts,
    total_sites,
    telegram_sent,
    last_sync,
    active_monitors,
    watchlist_count,
    totalAlerts: total_alerts,
    activeMonitors: active_monitors,
    lastSync: last_sync,
    totalSites: total_sites,
  };
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function HomePage() {
  // ---- UI state ----
  const [activeTab, setActiveTab] = useState<DashboardTab>('stream');
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const [hydrated, setHydrated] = useState(false);

  // ---- Data state ----
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [stats, setStats] = useState<ApiStats>({
    total_alerts: 0,
    total_sites: 0,
    telegram_sent: 0,
    last_sync: null,
    active_monitors: 0,
    watchlist_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  // ---- Filter state ----
  const [portalFilter, setPortalFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  /** When true the stream tab also restricts to the last 20-day window. */
  const [showLast20Days, setShowLast20Days] = useState(false);

  // ---- Pinned alerts state ----
  const [pinnedAlertIds, setPinnedAlertIds] = useState<string[]>([]);

  // ---- Watchlist state ----
  const [watchlist, setWatchlist] = useState<WatchlistPortal[]>([]);
  const [websiteName, setWebsiteName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [watchlistMessage, setWatchlistMessage] = useState<string | null>(null);
  const [watchlistMessageType, setWatchlistMessageType] = useState<'success' | 'info' | 'error'>('info');
  const [submittingWatchlist, setSubmittingWatchlist] = useState(false);

  // ---- Toast state and handlers ----
  const [activeToasts, setActiveToasts] = useState<ActiveToast[]>([]);

  const dismissToast = (id: string) => {
    setActiveToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const showToast = (item: NotificationItem) => {
    const newToast: ActiveToast = {
      id: item.id,
      examTitle: item.examTitle,
      agencyCode: item.agencyCode,
      category: item.category,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };

    setActiveToasts((prev) => {
      if (prev.some((t) => t.id === item.id)) return prev;
      return [...prev, newToast];
    });

    // Auto dismiss after 6 seconds
    setTimeout(() => {
      setActiveToasts((prev) => prev.filter((t) => t.id !== item.id));
    }, 6000);
  };

  // ---------------------------------------------------------------------------
  // Hydration — restore persisted state from localStorage
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    // Theme
    const storedTheme = window.localStorage.getItem(THEME_KEY);
    if (storedTheme === 'dark' || storedTheme === 'light') {
      setThemeMode(storedTheme);
    }

    // Pinned IDs
    const storedPins = window.localStorage.getItem(PINNED_KEY);
    if (storedPins) {
      try {
        const parsed = JSON.parse(storedPins);
        if (Array.isArray(parsed)) {
          setPinnedAlertIds(parsed.filter((e): e is string => typeof e === 'string'));
        }
      } catch {
        setPinnedAlertIds([]);
      }
    }

    // Watchlist (local cache only — backend is the source of truth on load)
    const storedWatchlist = window.localStorage.getItem(WATCHLIST_KEY);
    if (storedWatchlist) {
      try {
        const parsed = JSON.parse(storedWatchlist);
        if (Array.isArray(parsed)) {
          const restored = parsed.filter(isRecord).map((entry, index) => ({
            id: asText(entry.id) || `local-${Date.now()}-${index}`,
            websiteName: asText(entry.websiteName) || 'Unnamed Portal',
            targetUrl: asText(entry.targetUrl),
            synced: Boolean(entry.synced),
            createdAt: asText(entry.createdAt) || new Date().toISOString(),
          }));
          setWatchlist(restored);
        }
      } catch {
        setWatchlist([]);
      }
    }

    setHydrated(true);
  }, []);

  // ---------------------------------------------------------------------------
  // Theme persistence + class toggle
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') {
      return;
    }
    document.documentElement.classList.toggle('dark', themeMode === 'dark');
    window.localStorage.setItem(THEME_KEY, themeMode);
  }, [themeMode, hydrated]);

  // ---------------------------------------------------------------------------
  // Pinned IDs persistence
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(PINNED_KEY, JSON.stringify(pinnedAlertIds));
  }, [pinnedAlertIds, hydrated]);

  // ---------------------------------------------------------------------------
  // Watchlist persistence (local cache mirror)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  }, [watchlist, hydrated]);

  // ---------------------------------------------------------------------------
  // Data fetching — notifications + stats (polled every 45 s)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const fetchDashboardData = async () => {
      try {
        const updatesResponse = await fetch(`${API_BASE}/api/updates`, { cache: 'no-store' });
        if (!updatesResponse.ok) {
          throw new Error(`Unable to fetch updates (HTTP ${updatesResponse.status})`);
        }

        const updatesPayload: unknown = await updatesResponse.json();
        const updatesArray =
          isRecord(updatesPayload) && Array.isArray(updatesPayload.updates)
            ? updatesPayload.updates
            : [];

        const normalizedUpdates = updatesArray
          .filter(isRecord)
          .map((entry, index) =>
            normalizeNotification(entry as RawNotificationItem, index),
          )
          .sort((a, b) => b.createdAtMs - a.createdAtMs);

        // Compute fallbacks from the updates array in case /api/stats fails
        const fallbackPortalCount = new Set(normalizedUpdates.map((item) => item.agencyCode)).size;

        let nextStats: ApiStats = {
          total_alerts: normalizedUpdates.length,
          total_sites: fallbackPortalCount,
          telegram_sent: 0,
          last_sync: normalizedUpdates[0]?.createdAt ?? null,
          active_monitors: fallbackPortalCount,
          watchlist_count: 0,
        };

        try {
          const statsResponse = await fetch(`${API_BASE}/api/stats`, { cache: 'no-store' });
          if (statsResponse.ok) {
            const statsPayload: unknown = await statsResponse.json();
            if (isRecord(statsPayload)) {
              nextStats = parseApiStats(
                statsPayload as Record<string, unknown>,
                normalizedUpdates.length,
                fallbackPortalCount,
              );
              // If the API doesn't know the last_sync yet, fall back to local data
              if (!nextStats.last_sync) {
                nextStats.last_sync = normalizedUpdates[0]?.createdAt ?? null;
              }
            }
          }
        } catch {
          // Stats endpoint unavailable — use fallback computed from updates
          nextStats.total_alerts = Math.max(nextStats.total_alerts, normalizedUpdates.length);
        }

        if (!active) {
          return;
        }

        setNotifications((prevNotifications) => {
          if (prevNotifications.length > 0) {
            // It's a subsequent poll! Identify new updates not currently in cached state
            const existingIds = new Set(prevNotifications.map((n) => n.id));
            const newItems = normalizedUpdates.filter((n) => !existingIds.has(n.id));
            if (newItems.length > 0) {
              // Trigger a maximum of 3 elegant toasts at once to prevent flooding
              newItems.slice(0, 3).forEach((item) => {
                showToast(item);
              });
            }
          }
          return normalizedUpdates;
        });

        setStats(nextStats);
        setLastRefresh(new Date().toISOString());
        setError(null);
      } catch (fetchError) {
        if (!active) {
          return;
        }
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : 'Unable to load live updates. Check that the backend is running.',
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    fetchDashboardData();
    timer = setInterval(fetchDashboardData, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Derived / memoised data
  // ---------------------------------------------------------------------------

  /** All notifications from the last 20 days. */
  const recentTwentyDayUpdates = useMemo(
    () => notifications.filter((item) => isWithinLastDays(item.createdAtMs, DASHBOARD_WINDOW_DAYS)),
    [notifications],
  );

  /**
   * Stream feed: if the 20-day toggle is active, restrict to recent items;
   * otherwise show the full chronological list.
   */
  const streamFeedUpdates = useMemo(
    () => (showLast20Days ? recentTwentyDayUpdates : notifications),
    [showLast20Days, notifications, recentTwentyDayUpdates],
  );

  /** Pinned alerts drawn only from the 20-day window for relevance. */
  const pinnedAlerts = useMemo(
    () => recentTwentyDayUpdates.filter((item) => pinnedAlertIds.includes(item.id)),
    [recentTwentyDayUpdates, pinnedAlertIds],
  );

  /** Dashboard panel alerts filtered by portal + category (20-day window). */
  const filteredDashboardUpdates = useMemo(
    () =>
      recentTwentyDayUpdates.filter((item) => {
        const portalPass = portalFilter === 'all' || item.agencyCode === portalFilter;
        const categoryPass = categoryFilter === 'all' || item.category === categoryFilter;
        return portalPass && categoryPass;
      }),
    [recentTwentyDayUpdates, portalFilter, categoryFilter],
  );

  /** Unique portal options derived from the 20-day window for the filter dropdown. */
  const portalOptions = useMemo(() => {
    const entries = new Map<string, string>();
    recentTwentyDayUpdates.forEach((item) => {
      entries.set(item.agencyCode, item.siteName);
    });
    return Array.from(entries.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [recentTwentyDayUpdates]);

  /**
   * Total monitored portal count = distinct agency codes from all-time
   * notifications + custom watchlist entries.
   */
  const monitoredPortalCount = useMemo(() => {
    const fromUpdates = new Set(notifications.map((item) => item.agencyCode)).size;
    return fromUpdates + watchlist.length;
  }, [notifications, watchlist]);

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  const handleThemeToggle = () => {
    setThemeMode((current) => (current === 'light' ? 'dark' : 'light'));
  };

  const handlePinToggle = (id: string) => {
    setPinnedAlertIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [id, ...current],
    );
  };

  const handleWatchlistSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = websiteName.trim();
    const trimmedUrl = targetUrl.trim();

    if (!trimmedName || !trimmedUrl) {
      setWatchlistMessage('Please provide both website name and target URL.');
      setWatchlistMessageType('error');
      return;
    }
    if (!isValidHttpUrl(trimmedUrl)) {
      setWatchlistMessage('Please enter a valid HTTP or HTTPS URL (e.g. https://example.gov.in/).');
      setWatchlistMessageType('error');
      return;
    }

    // Optimistic local insert
    const tempId = `watch-${Date.now()}`;
    const localEntry: WatchlistPortal = {
      id: tempId,
      websiteName: trimmedName,
      targetUrl: trimmedUrl,
      synced: false,
      createdAt: new Date().toISOString(),
    };

    setSubmittingWatchlist(true);
    setWatchlist((current) => [localEntry, ...current]);
    setWebsiteName('');
    setTargetUrl('');
    setWatchlistMessage(null);

    try {
      const response = await fetch(`${API_BASE}/api/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website_name: trimmedName, target_url: trimmedUrl }),
      });

      if (response.ok) {
        const responseData: unknown = await response.json();
        // Replace the optimistic entry with the server-assigned id
        const serverId =
          isRecord(responseData) &&
          isRecord((responseData as Record<string, unknown>).portal)
            ? String(((responseData as Record<string, unknown>).portal as Record<string, unknown>).id ?? tempId)
            : tempId;

        setWatchlist((current) =>
          current.map((entry) =>
            entry.id === tempId
              ? { ...entry, id: serverId, synced: true }
              : entry,
          ),
        );
        setWatchlistMessage(`"${trimmedName}" added and synced with backend watchlist.`);
        setWatchlistMessageType('success');
      } else if (response.status === 409) {
        // Duplicate URL — remove the optimistic entry, show conflict message
        setWatchlist((current) => current.filter((entry) => entry.id !== tempId));
        setWatchlistMessage(`That URL is already in the watchlist.`);
        setWatchlistMessageType('error');
      } else {
        setWatchlistMessage('Portal saved locally. Backend watchlist endpoint returned an error.');
        setWatchlistMessageType('info');
      }
    } catch {
      setWatchlistMessage('Portal saved locally. Unable to reach the backend watchlist endpoint.');
      setWatchlistMessageType('info');
    } finally {
      setSubmittingWatchlist(false);
    }
  };

  const handleRemoveWatchlistPortal = async (portal: WatchlistPortal) => {
    // Optimistic removal
    setWatchlist((current) => current.filter((entry) => entry.id !== portal.id));

    // Attempt backend delete if synced (numeric id from server)
    const numericId = parseInt(portal.id, 10);
    if (!Number.isNaN(numericId) && portal.synced) {
      try {
        await fetch(`${API_BASE}/api/watchlist/${numericId}`, { method: 'DELETE' });
      } catch {
        // Silently ignore — local removal already applied
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Watchlist message colour helper
  // ---------------------------------------------------------------------------
  const watchlistMessageClass =
    watchlistMessageType === 'success'
      ? 'text-[var(--accent)] font-medium'
      : watchlistMessageType === 'error'
        ? 'text-[#c97a6a] font-medium'
        : 'text-[var(--text-secondary)]';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] transition-colors duration-300">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">

        {/* ================================================================
            HEADER
        ================================================================ */}
        <header className="surface-card mb-6 p-5 sm:p-6 animate-fade-in">
          <div className="flex flex-wrap items-start justify-between gap-4">
            {/* Branding */}
            <div>
              <p className="muted-label">Government Exam Intelligence</p>
              <h1 className="mt-2 text-3xl font-semibold sm:text-4xl leading-tight">
                Editorial Command Desk
              </h1>
              <p className="mt-2 text-sm text-[var(--text-secondary)] max-w-xl leading-relaxed">
                Real-time updates from TNPSC, SSC, UPSC, IBPS and allied exam portals with
                clean category intelligence and precision filtering.
              </p>
            </div>

            {/* Theme toggle */}
            <button
              type="button"
              onClick={handleThemeToggle}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-sm font-semibold transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)]"
              aria-label="Toggle theme"
            >
              {themeMode === 'dark' ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
              {themeMode === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>

          {/* Navigation tabs */}
          <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-1.5">
            <button
              id="tab-stream"
              type="button"
              onClick={() => setActiveTab('stream')}
              className={`nav-tab ${activeTab === 'stream' ? 'nav-tab-active' : 'nav-tab-inactive'}`}
            >
              <Newspaper className="h-4 w-4" />
              Live Updates Stream
            </button>
            <button
              id="tab-dashboard"
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`nav-tab ${activeTab === 'dashboard' ? 'nav-tab-active' : 'nav-tab-inactive'}`}
            >
              <LayoutGrid className="h-4 w-4" />
              Profile Dashboard
            </button>
          </div>
        </header>

        {/* ================================================================
            STATS ROW
        ================================================================ */}
        <DashboardStats
          totalWebsitesMonitored={Math.max(monitoredPortalCount, stats.active_monitors)}
          totalAlerts={Math.max(notifications.length, stats.total_alerts)}
          recentAlerts={recentTwentyDayUpdates.length}
          pinnedAlerts={pinnedAlerts.length}
          lastSyncTime={stats.last_sync}
        />

        {/* ================================================================
            MAIN CONTENT
        ================================================================ */}
        <div className="mt-6">
          {/* Error banner */}
          {error ? (
            <div className="error-banner mb-6">
              {error}
            </div>
          ) : null}

          {/* ---- STREAM TAB ---- */}
          {activeTab === 'stream' ? (
            <div className="space-y-4">
              {/* Stream controls row */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[var(--text-secondary)]">
                  {loading
                    ? 'Loading live updates from backend…'
                    : `${streamFeedUpdates.length} update${streamFeedUpdates.length !== 1 ? 's' : ''} · refreshed at ${formatRefreshLabel(lastRefresh)}`}
                </p>
                <button
                  id="toggle-20-days"
                  type="button"
                  onClick={() => setShowLast20Days((v) => !v)}
                  className={`btn-toggle ${showLast20Days ? 'btn-toggle-active' : ''}`}
                  aria-pressed={showLast20Days}
                >
                  <CalendarRange className="h-3.5 w-3.5" />
                  Show Last 20 Days
                </button>
              </div>

              <NotificationFeed
                title="Chronological Government Exam Stream"
                description={`Live feed refreshed every ${Math.round(REFRESH_INTERVAL_MS / 1000)}s.${showLast20Days ? ' Showing last 20 days only.' : ' Showing all-time history.'}`}
                updates={streamFeedUpdates}
                emptyMessage={
                  loading
                    ? 'Loading live updates from backend…'
                    : showLast20Days
                      ? 'No updates found in the last 20 days.'
                      : 'No updates available yet.'
                }
                pinnedIds={pinnedAlertIds}
                onTogglePin={handlePinToggle}
              />
            </div>
          ) : (
            /* ---- DASHBOARD TAB ---- */
            <section className="space-y-6">
              {/* Pinned alerts workspace */}
              <NotificationFeed
                title="Pinned Workspace Alerts"
                description="Your bookmarked alerts from the last 20 days for quick daily verification."
                updates={pinnedAlerts}
                emptyMessage="No pinned alerts in the last 20 days. Pin alerts from the stream tab using the bookmark button."
                pinnedIds={pinnedAlertIds}
                onTogglePin={handlePinToggle}
              />

              {/* Filter + Watchlist grid */}
              <div className="grid gap-6 lg:grid-cols-2">

                {/* ---- FILTER PANEL ---- */}
                <section className="surface-card p-5 animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
                  <p className="muted-label">Multi Filtering</p>
                  <h2 className="mt-2 text-2xl font-semibold">Profile Dashboard Filters</h2>
                  <p className="mt-2 text-sm text-[var(--text-secondary)]">
                    Filters apply to notifications from the last {DASHBOARD_WINDOW_DAYS} days.
                  </p>

                  <div className="mt-5 space-y-4">
                    {/* Portal filter */}
                    <div>
                      <label htmlFor="portal-filter" className="muted-label block pb-2">
                        <Filter className="inline h-3 w-3 mr-1.5 mb-0.5" />
                        Portal Filter
                      </label>
                      <select
                        id="portal-filter"
                        className="app-input"
                        value={portalFilter}
                        onChange={(e) => setPortalFilter(e.target.value)}
                      >
                        <option value="all">All Portals</option>
                        {portalOptions.map(([portalCode, portalName]) => (
                          <option key={portalCode} value={portalCode}>
                            {portalCode} — {portalName}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Category filter */}
                    <div>
                      <label htmlFor="category-filter" className="muted-label block pb-2">
                        <Filter className="inline h-3 w-3 mr-1.5 mb-0.5" />
                        Category Filter
                      </label>
                      <select
                        id="category-filter"
                        className="app-input"
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                      >
                        <option value="all">All Categories</option>
                        {CATEGORY_OPTIONS.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Reset filters */}
                    {(portalFilter !== 'all' || categoryFilter !== 'all') && (
                      <button
                        type="button"
                        onClick={() => {
                          setPortalFilter('all');
                          setCategoryFilter('all');
                        }}
                        className="text-xs text-[var(--text-secondary)] underline underline-offset-4 hover:text-[var(--accent)] transition-colors"
                      >
                        Reset all filters
                      </button>
                    )}
                  </div>
                </section>

                {/* ---- WATCHLIST PANEL ---- */}
                <section className="surface-card p-5 animate-fade-in-up" style={{ animationDelay: '0.10s' }}>
                  <p className="muted-label">Dynamic Watchlist</p>
                  <h2 className="mt-2 text-2xl font-semibold">Add Custom Portal to Track</h2>

                  <form className="mt-5 space-y-4" onSubmit={handleWatchlistSubmit}>
                    <div>
                      <label htmlFor="website-name" className="muted-label block pb-2">
                        Website Name
                      </label>
                      <input
                        id="website-name"
                        className="app-input"
                        value={websiteName}
                        onChange={(e) => setWebsiteName(e.target.value)}
                        placeholder="e.g., Kerala PSC"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label htmlFor="target-url" className="muted-label block pb-2">
                        Target URL
                      </label>
                      <input
                        id="target-url"
                        className="app-input"
                        value={targetUrl}
                        onChange={(e) => setTargetUrl(e.target.value)}
                        placeholder="https://keralapsc.gov.in/"
                        autoComplete="off"
                        inputMode="url"
                      />
                    </div>
                    <button
                      id="add-portal-btn"
                      type="submit"
                      disabled={submittingWatchlist}
                      className="btn-primary"
                    >
                      <Plus className="h-4 w-4" />
                      {submittingWatchlist ? 'Saving…' : 'Add Portal'}
                    </button>
                  </form>

                  {watchlistMessage ? (
                    <p className={`mt-3 text-sm ${watchlistMessageClass}`}>
                      {watchlistMessage}
                    </p>
                  ) : null}

                  {/* Watchlist entries */}
                  <div className="mt-5 max-h-52 space-y-2 overflow-auto pr-1">
                    {watchlist.length === 0 ? (
                      <p className="text-sm text-[var(--text-secondary)]">
                        No custom portals added yet.
                      </p>
                    ) : (
                      watchlist.map((portal) => (
                        <div
                          key={portal.id}
                          className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm animate-slide-in"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold truncate">{portal.websiteName}</span>
                                <span className={portal.synced ? 'chip-synced' : 'chip-local'}>
                                  {portal.synced ? 'Synced' : 'Local'}
                                </span>
                              </div>
                              <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">
                                {portal.targetUrl}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveWatchlistPortal(portal)}
                              aria-label={`Remove ${portal.websiteName} from watchlist`}
                              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[#c97a6a] hover:bg-[#f2e6e2] dark:hover:bg-[#2a1c18] transition-colors flex-shrink-0"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>

              {/* Filtered alerts feed */}
              <NotificationFeed
                title={`Filtered Alerts — Last ${DASHBOARD_WINDOW_DAYS} Days`}
                description={`Portal: ${portalFilter === 'all' ? 'All' : portalFilter} · Category: ${categoryFilter === 'all' ? 'All' : categoryFilter} · ${filteredDashboardUpdates.length} result${filteredDashboardUpdates.length !== 1 ? 's' : ''}`}
                updates={filteredDashboardUpdates}
                emptyMessage="No alerts match the current filter combination in the last 20 days."
                pinnedIds={pinnedAlertIds}
                onTogglePin={handlePinToggle}
              />
            </section>
          )}
        </div>

        {/* ================================================================
            FOOTER
        ================================================================ */}
        <footer className="mt-10 pb-6 text-center text-xs text-[var(--text-secondary)]">
          <hr className="editorial-divider mb-6" />
          GovExam Editorial Tracker · Updates every {Math.round(REFRESH_INTERVAL_MS / 1000)}s ·
          &nbsp;
          <span className="live-badge inline-flex">Live</span>
        </footer>

      </div>

      {/* Elegant state-driven real-time toast alert window notification */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {activeToasts.map((toast) => {
          const badgeStyle = categoryStyles[toast.category] || categoryStyles['General Notification'];
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-elevated)] transition-all duration-300 animate-slide-in-toast"
              role="alert"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="badge-agency text-[10px] py-0.5 px-2">
                      {toast.agencyCode}
                    </span>
                    <span className={`text-[10px] font-semibold py-0.5 px-2 rounded-full border ${badgeStyle}`}>
                      {toast.category}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)]">
                      {toast.timestamp}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-[var(--text-primary)] font-body leading-snug line-clamp-2">
                    {toast.examTitle}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors p-1 flex-shrink-0"
                  aria-label="Dismiss notification"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center justify-between border-t border-[var(--border)] pt-2.5">
                <span className="text-[11px] text-[var(--text-secondary)]">New announcement detected</span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('stream');
                    // Delay slightly to allow tab switch layout cycle to render
                    setTimeout(() => {
                      const element = document.getElementById(`notification-card-${toast.id}`);
                      if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        element.classList.add('highlight-flash');
                        setTimeout(() => {
                          element.classList.remove('highlight-flash');
                        }, 2500);
                      }
                    }, 50);
                    dismissToast(toast.id);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors underline underline-offset-4"
                >
                  View Details
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
