'use client';

import { useEffect } from 'react';
import { clientGet, clientSet } from '@/lib/client-cache';

export function PreloadTabs() {
  useEffect(() => {
    const t = setTimeout(() => {
      if (!clientGet('billing')) {
        fetch('/api/billing').then(r => r.json()).then(d => clientSet('billing', d)).catch(() => {});
      }
      if (!clientGet('invoices')) {
        fetch('/api/invoices').then(r => r.json()).then(d => clientSet('invoices', Array.isArray(d) ? d : [])).catch(() => {});
      }
      if (!clientGet('summary')) {
        fetch('/api/summary').then(r => r.json()).then(d => clientSet('summary', Array.isArray(d) ? d : [])).catch(() => {});
      }
    }, 1500);
    return () => clearTimeout(t);
  }, []);
  return null;
}
