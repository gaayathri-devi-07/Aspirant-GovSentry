"use client";

import React from 'react';
import { Bell, Bookmark, Clock3, Globe2 } from 'lucide-react';

interface DashboardStatsProps {
  totalWebsitesMonitored: number;
  totalAlerts: number;
  recentAlerts: number;
  pinnedAlerts: number;
  lastSyncTime: string | null;
}

function formatLastSync(lastSyncTime: string | null): string {
  if (!lastSyncTime) {
    return 'Not synced yet';
  }
  const parsed = Date.parse(lastSyncTime);
  if (!Number.isFinite(parsed)) {
    return 'Not synced yet';
  }
  return new Date(parsed).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface StatCardProps {
  icon: React.ReactNode;
  title: string;
  value: string;
  helper: string;
  showLivePulse?: boolean;
  animationDelay?: string;
}

function StatCard({ icon, title, value, helper, showLivePulse = false, animationDelay = '0s' }: StatCardProps) {
  return (
    <article
      className="surface-card p-5 animate-fade-in-up"
      style={{ animationDelay }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-3">
            {showLivePulse && <span className="live-badge">Live</span>}
            {!showLivePulse && <p className="muted-label">{title}</p>}
            {showLivePulse && <p className="muted-label">{title}</p>}
          </div>
          <p className="stat-number">{value}</p>
          <p className="mt-2 text-xs text-[var(--text-secondary)] leading-relaxed">{helper}</p>
        </div>
        <div className="gradient-icon-wrap">
          {icon}
        </div>
      </div>
    </article>
  );
}

export default function DashboardStats({
  totalWebsitesMonitored,
  totalAlerts,
  recentAlerts,
  pinnedAlerts,
  lastSyncTime,
}: DashboardStatsProps) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={<Globe2 className="h-5 w-5" />}
        title="Portals Monitored"
        value={String(totalWebsitesMonitored)}
        helper="Tracked portals from API + custom watchlist."
        showLivePulse={true}
        animationDelay="0.05s"
      />
      <StatCard
        icon={<Bell className="h-5 w-5" />}
        title="Total Alerts"
        value={String(totalAlerts)}
        helper="Chronological stream volume from backend."
        animationDelay="0.10s"
      />
      <StatCard
        icon={<Clock3 className="h-5 w-5" />}
        title="Last 20 Days"
        value={String(recentAlerts)}
        helper={`Last sync: ${formatLastSync(lastSyncTime)}`}
        animationDelay="0.15s"
      />
      <StatCard
        icon={<Bookmark className="h-5 w-5" />}
        title="Pinned Alerts"
        value={String(pinnedAlerts)}
        helper="Priority updates saved for quick verification."
        animationDelay="0.20s"
      />
    </section>
  );
}
