"use client";

import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Menu, X, Sun, Moon, ArrowLeft, Filter, CalendarRange, Trash2, Plus,
  Radio, User, Briefcase, Globe, Settings, TrendingUp, ShieldCheck
} from 'lucide-react';
import DashboardStats from '../../../components/DashboardStats';
import NotificationFeed, {
  CrmStatus,
  NotificationItem,
  RawNotificationItem,
  UserProfile,
  normalizeNotification,
} from '../../../components/NotificationFeed';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type ThemeMode = 'light' | 'dark';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';
const THEME_KEY = 'govexam-theme-mode';
const PINNED_KEY = 'govexam-pinned-alerts';
const WATCHLIST_KEY = 'govexam-watchlist-portals';
const PROFILE_KEY = 'govsentry_user_profile';
const REFRESH_INTERVAL_MS = 45_000;

const DEFAULT_PORTALS = [
  { name: 'SSC', label: 'Staff Selection Commission' },
  { name: 'TNPSC', label: 'Tamil Nadu PSC' },
  { name: 'UPSC', label: 'Union PSC' },
  { name: 'IBPS', label: 'Banking Personnel Selection' },
  { name: 'NTA', label: 'National Testing Agency' },
  { name: 'RRB', label: 'Railway Recruitment Board' },
];

const PORTALS_MAP: Record<string, string> = {
  ssc: 'Staff Selection Commission (SSC)',
  tnpsc: 'Tamil Nadu Public Service Commission (TNPSC)',
  upsc: 'Union Public Service Commission (UPSC)',
  ibps: 'Institute of Banking Personnel Selection (IBPS)',
  nta: 'National Testing Agency (NTA)',
  rrb: 'Railway Recruitment Board (RRB)',
};

interface ApiStats {
  total_alerts: number;
  total_sites: number;
  telegram_sent: number;
  last_sync: string | null;
  active_monitors: number;
  watchlist_count: number;
}

interface WatchlistPortal {
  id: string;
  websiteName: string;
  targetUrl: string;
  synced: boolean;
  createdAt: string;
}

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

function isWithinLast15Days(timestampMs: number): boolean {
  if (!timestampMs) return false;
  const nowMs = Date.now();
  const minAllowed = nowMs - 15 * 24 * 60 * 60 * 1000;
  return timestampMs >= minAllowed && timestampMs <= nowMs;
}

function parseApiStats(
  payload: Record<string, unknown>,
  fallbackLength: number,
  fallbackPortalCount: number,
): ApiStats {
  const total_alerts = asNumber(payload.totalAlerts) || asNumber(payload.total_alerts) || fallbackLength;
  const active_monitors = asNumber(payload.activeMonitors) || asNumber(payload.active_monitors) || fallbackPortalCount;
  const total_sites = asNumber(payload.totalSites) || asNumber(payload.total_sites) || fallbackPortalCount;
  const telegram_sent = asNumber(payload.telegramSent) || asNumber(payload.telegram_sent);
  const watchlist_count = asNumber(payload.watchlistCount) || asNumber(payload.watchlist_count);
  const last_sync = asText(payload.lastSync) || asText(payload.last_sync) || null;

  return { total_alerts, total_sites, telegram_sent, last_sync, active_monitors, watchlist_count };
}

// ---------------------------------------------------------------------------
// Drawer Component
// ---------------------------------------------------------------------------

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  userProfile: UserProfile;
  watchlist: WatchlistPortal[];
  activePortal: string;
  onRemoveWatchlist: (p: WatchlistPortal) => void;
  onWatchlistSubmit: (e: FormEvent<HTMLFormElement>) => void;
  websiteName: string;
  setWebsiteName: (v: string) => void;
  targetUrl: string;
  setTargetUrl: (v: string) => void;
  watchlistMessage: string | null;
  watchlistMessageType: 'success' | 'info' | 'error';
  submittingWatchlist: boolean;
}

function Drawer({
  open, onClose, userProfile, watchlist, activePortal, onRemoveWatchlist,
  onWatchlistSubmit, websiteName, setWebsiteName, targetUrl, setTargetUrl,
  watchlistMessage, watchlistMessageType, submittingWatchlist
}: DrawerProps) {
  if (!open) return null;

  return (
    <div className="relative z-[9999]">
      <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />
      <aside className="drawer-panel" role="dialog" aria-label="Navigation Drawer">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <p className="muted-label">Navigation</p>
            <h2 className="text-base font-bold text-[var(--text-primary)] mt-0.5">Aspirant GovSentry</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-[var(--surface-soft)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Close drawer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* User Profile */}
          <div className="drawer-section">
            <div className="flex items-center gap-2 mb-3">
              <User className="h-3.5 w-3.5 text-[var(--accent)]" />
              <p className="drawer-section-title m-0">User Profile</p>
            </div>
            <Link
              href={userProfile.keywords ? "/settings" : "/profile"}
              onClick={onClose}
              className="portal-btn justify-center font-bold"
            >
              {userProfile.keywords ? 'Edit Profile & Keywords' : 'Create Profile'}
            </Link>
          </div>

          {/* Settings */}
          <div className="drawer-section">
            <div className="flex items-center gap-2 mb-3">
              <Settings className="h-3.5 w-3.5 text-[var(--accent)]" />
              <p className="drawer-section-title m-0">Control Center</p>
            </div>
            <Link href="/settings" onClick={onClose} className="portal-btn justify-center">
              Go to Settings
            </Link>
          </div>

          {/* Default Portals */}
          <div className="drawer-section">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="h-3.5 w-3.5 text-[var(--accent)]" />
              <p className="drawer-section-title m-0">Default Monitoring Channels</p>
            </div>
            <div className="space-y-1.5">
              <Link href="/" onClick={onClose} className="portal-btn">
                <TrendingUp className="h-3.5 w-3.5 flex-shrink-0" />
                All Portals (Today's Feed)
              </Link>
              {DEFAULT_PORTALS.map((portal) => (
                <Link
                  key={portal.name}
                  href={`/portal/${portal.name.toLowerCase()}`}
                  onClick={onClose}
                  className={`portal-btn ${activePortal === portal.name.toLowerCase() ? 'portal-btn-active' : ''}`}
                >
                  <span className="font-mono text-[10px] font-bold opacity-60">{portal.name}</span>
                  {portal.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Tailor Watchlist */}
          <div className="drawer-section">
            <div className="flex items-center gap-2 mb-3">
              <Plus className="h-3.5 w-3.5 text-[var(--accent)]" />
              <p className="drawer-section-title m-0">Watchlist Addition</p>
            </div>
            <form onSubmit={onWatchlistSubmit} className="space-y-2">
              <input
                type="text"
                placeholder="Portal name"
                className="app-input text-sm"
                value={websiteName}
                onChange={(e) => setWebsiteName(e.target.value)}
                required
              />
              <input
                type="url"
                placeholder="https://"
                className="app-input text-sm"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                required
              />
              <button
                type="submit"
                disabled={submittingWatchlist}
                className="btn-primary w-full justify-center text-xs"
              >
                Track This URL
              </button>
            </form>
            {watchlistMessage && (
              <p className="mt-2 text-xs text-emerald-600 font-medium">{watchlistMessage}</p>
            )}
            {watchlist.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {watchlist.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs"
                  >
                    <span className="font-semibold truncate">{p.websiteName}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveWatchlist(p)}
                      className="text-[var(--text-secondary)] hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dynamic Portal Page Component
// ---------------------------------------------------------------------------

export default function PortalPage() {
  const params = useParams();
  const source = (params.source as string || '').toLowerCase();
  
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const [hydrated, setHydrated] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [stats, setStats] = useState<ApiStats>({
    total_alerts: 0, total_sites: 0, telegram_sent: 0,
    last_sync: null, active_monitors: 0, watchlist_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile>({ keywords: '' });
  const [pinnedAlertIds, setPinnedAlertIds] = useState<string[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistPortal[]>([]);

  // Watchlist states
  const [websiteName, setWebsiteName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [watchlistMessage, setWatchlistMessage] = useState<string | null>(null);
  const [watchlistMessageType, setWatchlistMessageType] = useState<'success' | 'info' | 'error'>('info');
  const [submittingWatchlist, setSubmittingWatchlist] = useState(false);

  const agencyCode = source.toUpperCase();
  const portalName = PORTALS_MAP[source] || `${agencyCode} Exam Portal`;

  // Hydrate states
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storedTheme = window.localStorage.getItem(THEME_KEY);
    if (storedTheme === 'dark' || storedTheme === 'light') setThemeMode(storedTheme);

    const storedPins = window.localStorage.getItem(PINNED_KEY);
    if (storedPins) {
      try {
        const parsed = JSON.parse(storedPins);
        if (Array.isArray(parsed)) setPinnedAlertIds(parsed.filter((e): e is string => typeof e === 'string'));
      } catch { /* ignore */ }
    }

    const storedProfile = window.localStorage.getItem(PROFILE_KEY);
    if (storedProfile) {
      try {
        const parsed = JSON.parse(storedProfile);
        if (isRecord(parsed) && typeof parsed.keywords === 'string') {
          setUserProfile({ keywords: parsed.keywords });
        }
      } catch { /* ignore */ }
    }

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
      } catch { /* ignore */ }
    }

    setHydrated(true);
  }, []);

  // Theme & Pins persistence
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    document.documentElement.classList.toggle('dark', themeMode === 'dark');
    window.localStorage.setItem(THEME_KEY, themeMode);
  }, [themeMode, hydrated]);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    window.localStorage.setItem(PINNED_KEY, JSON.stringify(pinnedAlertIds));
  }, [pinnedAlertIds, hydrated]);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  }, [watchlist, hydrated]);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      const updatesResponse = await fetch(`${API_BASE}/api/updates`, { cache: 'no-store' });
      if (!updatesResponse.ok) throw new Error(`Unable to fetch updates (HTTP ${updatesResponse.status})`);

      const updatesPayload: unknown = await updatesResponse.json();
      const rawArray: unknown[] = isRecord(updatesPayload) && Array.isArray(updatesPayload.updates)
        ? updatesPayload.updates : [];

      // Wrap each normalizeNotification in try/catch so one bad record never crashes all
      const normalized: NotificationItem[] = [];
      rawArray.filter(isRecord).forEach((entry, index) => {
        try {
          const item = normalizeNotification(entry as RawNotificationItem, index);
          if (item) normalized.push(item);
        } catch {
          // Silently skip malformed records
        }
      });

      // Safe sort with optional chaining
      normalized.sort((a, b) => (b?.createdAtMs ?? 0) - (a?.createdAtMs ?? 0));

      const fallbackPortalCount = new Set(normalized.map((item) => item?.agencyCode ?? '')).size;
      let nextStats: ApiStats = {
        total_alerts: normalized.length,
        total_sites: fallbackPortalCount,
        telegram_sent: 0,
        last_sync: normalized[0]?.createdAt ?? null,
        active_monitors: fallbackPortalCount,
        watchlist_count: 0,
      };

      try {
        const statsResponse = await fetch(`${API_BASE}/api/stats`, { cache: 'no-store' });
        if (statsResponse.ok) {
          const statsPayload: unknown = await statsResponse.json();
          if (isRecord(statsPayload)) {
            nextStats = parseApiStats(statsPayload as Record<string, unknown>, normalized.length, fallbackPortalCount);
          }
        }
      } catch { /* ignore */ }

      setNotifications(normalized);
      setStats(nextStats);
      setError(null);
    } catch (e) {
      setNotifications([]);
      setError('Unable to load portal updates. The backend intelligence server is currently offline or restarting. Please ensure it is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // CRM status change handler
  const handleStatusChange = useCallback((id: string, newStatus: CrmStatus) => {
    setNotifications((prev) =>
      prev.map((n) => n.id === id ? { ...n, userStatus: newStatus } : n)
    );
  }, []);

  const handlePinToggle = (id: string) =>
    setPinnedAlertIds((c) => c.includes(id) ? c.filter((e) => e !== id) : [id, ...c]);

  // Watchlist submission
  const handleWatchlistSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = websiteName.trim();
    const trimmedUrl = targetUrl.trim();
    if (!trimmedName || !trimmedUrl) return;

    const tempId = `watch-${Date.now()}`;
    const localEntry: WatchlistPortal = {
      id: tempId, websiteName: trimmedName, targetUrl: trimmedUrl,
      synced: false, createdAt: new Date().toISOString(),
    };

    setSubmittingWatchlist(true);
    setWatchlist((c) => [localEntry, ...c]);
    setWebsiteName('');
    setTargetUrl('');

    try {
      const response = await fetch(`${API_BASE}/api/track-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website_name: trimmedName, target_url: trimmedUrl }),
      });
      if (response.ok) {
        setWatchlist((c) => c.map((e) => e.id === tempId ? { ...e, synced: true } : e));
        setWatchlistMessage('Portal tracked successfully.');
        setWatchlistMessageType('success');
      } else {
        setWatchlistMessage('Portal saved locally.');
        setWatchlistMessageType('info');
      }
    } catch {
      setWatchlistMessage('Saved locally (network error).');
      setWatchlistMessageType('info');
    } finally {
      setSubmittingWatchlist(false);
    }
  };

  const handleRemoveWatchlistPortal = async (portal: WatchlistPortal) => {
    setWatchlist((c) => c.filter((e) => e.id !== portal.id));
    const numericId = parseInt(portal.id, 10);
    if (!Number.isNaN(numericId) && portal.synced) {
      try {
        await fetch(`${API_BASE}/api/watchlist/${numericId}`, { method: 'DELETE' });
      } catch { /* ignore */ }
    }
  };

  // Filter ONLY notifications matching agencyCode AND within last 15 days — with null safety
  const portalFeedUpdates = useMemo(() => {
    if (!notifications?.length) return [];
    try {
      return notifications.filter((item) => {
        if (!item) return false;
        const matchesAgency = (item?.agencyCode ?? '') === agencyCode;
        const matches15Days = isWithinLast15Days(item?.createdAtMs ?? 0);
        return matchesAgency && matches15Days;
      });
    } catch {
      return [];
    }
  }, [notifications, agencyCode]);

  const pinnedPortalUpdates = useMemo(() => {
    if (!portalFeedUpdates?.length || !pinnedAlertIds?.length) return [];
    try {
      return portalFeedUpdates.filter((item) => item?.id && pinnedAlertIds.includes(item.id));
    } catch {
      return [];
    }
  }, [portalFeedUpdates, pinnedAlertIds]);

  const monitoredPortalCount = useMemo(() => {
    try {
      const fromUpdates = new Set((notifications ?? []).map((item) => item?.agencyCode ?? '')).size;
      return fromUpdates + (watchlist?.length ?? 0);
    } catch {
      return 0;
    }
  }, [notifications, watchlist]);

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] transition-colors duration-300">
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        userProfile={userProfile}
        watchlist={watchlist}
        activePortal={source}
        onRemoveWatchlist={handleRemoveWatchlistPortal}
        onWatchlistSubmit={handleWatchlistSubmit}
        websiteName={websiteName}
        setWebsiteName={setWebsiteName}
        targetUrl={targetUrl}
        setTargetUrl={setTargetUrl}
        watchlistMessage={watchlistMessage}
        watchlistMessageType={watchlistMessageType}
        submittingWatchlist={submittingWatchlist}
      />

      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        
        {/* Navigation link back to stream */}
        <div className="mb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors bg-[var(--surface-soft)] px-3.5 py-2.5 rounded-xl border border-[var(--border)] shadow-sm"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Live Stream
          </Link>
        </div>

        {/* Portal Header */}
        <header className="surface-card mb-6 p-5 sm:p-6 animate-fade-in">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="mt-1 flex-shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-2.5 text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-all"
                aria-label="Open navigation drawer"
              >
                <Menu className="h-5 w-5" />
              </button>

              <div>
                <p className="muted-label">Dynamic Monitoring Portal</p>
                <h1 className="mt-1.5 text-3xl font-semibold sm:text-4xl leading-tight">
                  {portalName}
                </h1>
                <p className="mt-2 text-sm text-[var(--text-secondary)] max-w-2xl leading-relaxed">
                  Dedicated feed showing live updates and countdowns specifically for {portalName} detected within the last 15 days.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setThemeMode((c) => (c === 'light' ? 'dark' : 'light'))}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-sm font-semibold transition-all"
            >
              {themeMode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {themeMode === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
        </header>

        {/* Stats Row */}
        <DashboardStats
          totalWebsitesMonitored={Math.max(monitoredPortalCount, stats.active_monitors)}
          totalAlerts={Math.max(notifications.length, stats.total_alerts)}
          recentAlerts={portalFeedUpdates.length}
          pinnedAlerts={pinnedPortalUpdates.length}
          lastSyncTime={stats.last_sync}
        />

        <div className="mt-6 space-y-6">
          {error && <div className="error-banner">{error}</div>}

          {pinnedPortalUpdates.length > 0 && (
            <NotificationFeed
              title={`📌 Pinned alerts from ${agencyCode}`}
              description="Priority updates from this portal saved for verification."
              updates={pinnedPortalUpdates}
              emptyMessage=""
              pinnedIds={pinnedAlertIds}
              onTogglePin={handlePinToggle}
              userProfile={userProfile}
              apiBase={API_BASE}
              onStatusChange={handleStatusChange}
            />
          )}

          <NotificationFeed
            title={`Updates from ${agencyCode}`}
            description={`Showing notifications fetched from ${portalName} in the last 15 days.`}
            updates={portalFeedUpdates ?? []}
            emptyMessage={
              loading
                ? 'Loading portal updates…'
                : `No announcements posted by this portal in the last 15 days.`
            }
            pinnedIds={pinnedAlertIds ?? []}
            onTogglePin={handlePinToggle}
            userProfile={userProfile}
            apiBase={API_BASE}
            onStatusChange={handleStatusChange}
          />
        </div>
      </div>
    </main>
  );
}
