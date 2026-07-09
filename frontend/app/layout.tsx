import type { Metadata, Viewport } from 'next';
import { Playfair_Display, Space_Grotesk } from 'next/font/google';
import './globals.css';

const displaySerif = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600', '700'],
  display: 'swap',
});

const bodySans = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'GovExam Editorial Tracker — Live Government Exam Intelligence',
  description:
    'Premium real-time dashboard tracking government exam notifications across UPSC, TNPSC, SSC, IBPS, NTA and allied portals. Get instant alerts for exam dates, admit cards, results and answer keys.',
  keywords: [
    'government exam notifications',
    'UPSC alerts',
    'TNPSC updates',
    'SSC exam dates',
    'admit card release',
    'exam results tracker',
  ],
  openGraph: {
    title: 'GovExam Editorial Tracker',
    description:
      'Premium real-time dashboard for live government exam intelligence — exam dates, admit cards, results, answer keys.',
    type: 'website',
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary',
    title: 'GovExam Editorial Tracker',
    description: 'Live government exam intelligence dashboard.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${displaySerif.variable} ${bodySans.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
