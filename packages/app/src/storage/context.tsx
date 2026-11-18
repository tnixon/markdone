import React, { createContext, useContext, useMemo } from 'react';
import type { AppStorage } from './appStorage';
import { LocalAppStorage } from './appStorage';

const StorageContext = createContext<AppStorage | null>(null);

export function StorageProvider({
  storage,
  children,
}: {
  storage?: AppStorage;
  children: React.ReactNode;
}) {
  const resolved = useMemo(() => storage ?? new LocalAppStorage(), [storage]);
  return <StorageContext.Provider value={resolved}>{children}</StorageContext.Provider>;
}

export function useStorage(): AppStorage {
  const ctx = useContext(StorageContext);
  if (!ctx) throw new Error('useStorage must be used within a StorageProvider');
  return ctx;
}
