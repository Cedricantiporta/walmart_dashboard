import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'WFS Billing Dashboard',
  description: 'Walmart Fulfillment Services billing management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <head>
        {/* Prevent dark mode flash — runs before React hydrates */}
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem('darkMode')==='1'){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
