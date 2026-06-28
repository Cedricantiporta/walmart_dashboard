'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const last = localStorage.getItem('wfs_last_page');
    router.replace(last && last.startsWith('/dashboard') ? last : '/dashboard');
  }, [router]);
  return null;
}
