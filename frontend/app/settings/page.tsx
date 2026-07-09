"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { User, Mail, GraduationCap, Save, Trash2, ArrowLeft, Settings, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

interface UserProfileData {
  name: string;
  email: string;
  keywords: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [keywords, setKeywords] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<'success' | 'error'>('success');

  useEffect(() => {
    // Read current theme state from localStorage
    const savedTheme = localStorage.getItem('govexam-theme-mode');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // Prefill profile data from localStorage
    const existing = localStorage.getItem('govsentry_user_profile');
    if (existing) {
      try {
        const parsed: UserProfileData = JSON.parse(existing);
        setName(parsed.name || '');
        setEmail(parsed.email || '');
        setKeywords(parsed.keywords || '');
      } catch (e) {
        // ignore parsing error
      }
    }
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    const profileData: UserProfileData = {
      name: name.trim(),
      email: email.trim(),
      keywords: keywords.trim(),
    };

    localStorage.setItem('govsentry_user_profile', JSON.stringify(profileData));
    localStorage.setItem('govexam-user-profile', JSON.stringify({ keywords: keywords.trim() }));

    setStatusMessage('Settings updated successfully!');
    setStatusType('success');

    // Auto clear status message after 4s
    setTimeout(() => {
      setStatusMessage(null);
    }, 4000);
  };

  const handleClearAll = () => {
    if (confirm('Are you sure you want to clear all profile, watchlist, and application portfolio data? This action cannot be undone.')) {
      localStorage.removeItem('govsentry_user_profile');
      localStorage.removeItem('govexam-user-profile');
      localStorage.removeItem('govexam-pinned-alerts');
      localStorage.removeItem('govexam-watchlist-portals');
      
      // Redirect back to profile page
      router.push('/profile');
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] transition-colors duration-300 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Navigation link back to stream */}
        <div className="mb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Live Stream
          </Link>
        </div>

        {/* Branding header */}
        <div className="text-center mb-6 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-300/40 bg-emerald-50 dark:border-emerald-700/30 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 text-xs font-semibold uppercase tracking-wider mb-2">
            <Settings className="h-4 w-4" />
            Account settings
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            Editorial Settings
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Manage your personal profile and clean your cache data.
          </p>
        </div>

        {/* Settings Card */}
        <article className="surface-card p-6 sm:p-8 animate-fade-in-up">
          <form onSubmit={handleSave} className="space-y-6">
            {/* Full Name */}
            <div>
              <label htmlFor="fullname" className="muted-label block pb-2 flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                Full Name
              </label>
              <input
                id="fullname"
                type="text"
                className="app-input"
                placeholder="Enter your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {/* Email Address */}
            <div>
              <label htmlFor="emailaddr" className="muted-label block pb-2 flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                Email Address
              </label>
              <input
                id="emailaddr"
                type="email"
                className="app-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {/* Qualifications / Target Keywords */}
            <div>
              <label htmlFor="qualifications" className="muted-label block pb-2 flex items-center gap-2">
                <GraduationCap className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                Qualifications / Target Keywords
              </label>
              <textarea
                id="qualifications"
                rows={3}
                className="app-input resize-none"
                placeholder="Degrees, target agencies, syllabus matching words…"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                required
              />
            </div>

            {/* Status alerts */}
            {statusMessage && (
              <div className={`text-xs font-semibold ${statusType === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {statusMessage}
              </div>
            )}

            {/* Buttons Row */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="submit"
                className="btn-primary flex-1 justify-center py-2.5 text-xs font-semibold"
              >
                <Save className="h-4 w-4" />
                Save Settings
              </button>
              
              <button
                type="button"
                onClick={handleClearAll}
                className="border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/40 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all flex items-center justify-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Clear All Data
              </button>
            </div>
          </form>
        </article>
      </div>
    </main>
  );
}
