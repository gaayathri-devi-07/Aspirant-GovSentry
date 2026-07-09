"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { User, Mail, GraduationCap, ArrowRight, ShieldCheck } from 'lucide-react';

interface UserProfileData {
  name: string;
  email: string;
  keywords: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [keywords, setKeywords] = useState('');
  const [isThemeDark, setIsThemeDark] = useState(false);

  useEffect(() => {
    // Read current theme state from localStorage
    const savedTheme = localStorage.getItem('govexam-theme-mode');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
      setIsThemeDark(true);
    } else {
      document.documentElement.classList.remove('dark');
      setIsThemeDark(false);
    }

    // Prefill if data already exists
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const profileData: UserProfileData = {
      name: name.trim(),
      email: email.trim(),
      keywords: keywords.trim(),
    };

    localStorage.setItem('govsentry_user_profile', JSON.stringify(profileData));
    
    // Also save key to 'govexam-user-profile' for backward compatibility
    localStorage.setItem('govexam-user-profile', JSON.stringify({ keywords: keywords.trim() }));

    // Redirect to home page
    router.push('/');
  };

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] transition-colors duration-300 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Branding header */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-300/40 bg-emerald-50 dark:border-emerald-700/30 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 text-xs font-semibold uppercase tracking-wider mb-3">
            <ShieldCheck className="h-4 w-4" />
            Secure SaaS onboarding
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl text-[var(--text-primary)]">
            Create Your Profile
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Aspirant GovSentry tailors your exam dashboard using your qualifications and target preferences.
          </p>
        </div>

        {/* Central form card */}
        <article className="surface-card p-6 sm:p-8 animate-fade-in-up">
          <form onSubmit={handleSubmit} className="space-y-6">
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

            {/* Target Keywords / Qualifications */}
            <div>
              <label htmlFor="qualifications" className="muted-label block pb-2 flex items-center gap-2">
                <GraduationCap className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                Qualifications / Target Keywords
              </label>
              <p className="text-xs text-[var(--text-secondary)] mb-2 leading-relaxed">
                Provide degrees, exam boards, or positions (e.g. "B.E. Computer Science, UPSC, SSC, Group 4").
              </p>
              <textarea
                id="qualifications"
                rows={3}
                className="app-input resize-none"
                placeholder="B.E. Computer Science, SSC, UPSC, Civil Services, Graduate..."
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                required
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="btn-primary w-full justify-center py-3 text-sm mt-2"
            >
              Get Started
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </article>

        {/* Footer info */}
        <p className="text-center mt-6 text-xs text-[var(--text-secondary)]">
          Your profile data is stored securely in your browser's local state.
        </p>
      </div>
    </main>
  );
}
