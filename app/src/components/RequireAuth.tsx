import React from 'react';
import { router } from 'expo-router';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { NavScreen } from './ui/Screen';
import { EmptyState, LoadingState } from './ui/States';

/** Shows a login prompt instead of `children` when nobody is logged in. */
export function RequireAuth({ children, message }: { children: React.ReactNode; message?: string }) {
  const { user, loading, offline, retry } = useAuth();
  const { t } = useI18n();
  if (loading) return <LoadingState />;
  if (!user && offline) {
    return (
      <NavScreen>
        <EmptyState icon="info" title={t('errors.offline')} actionLabel={t('common.retry')} onAction={retry} />
      </NavScreen>
    );
  }
  if (!user) {
    return (
      <NavScreen>
        <EmptyState icon="lock" title={message ?? t('common.loginRequired')} actionLabel={t('common.login')} onAction={() => router.push('/login')} />
      </NavScreen>
    );
  }
  return <>{children}</>;
}
