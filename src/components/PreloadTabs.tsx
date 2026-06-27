'use client';

import { useEffect } from 'react';

export function PreloadTabs() {
  useEffect(() => {
    const t = setTimeout(() => {
      fetch('/api/billing').catch(() => {});
      fetch('/api/dashboard/analytics?timeRange=thisMonth').catch(() => {});
      fetch('/api/invoices').catch(() => {});
      fetch('/api/summary').catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, []);
  return null;
}
