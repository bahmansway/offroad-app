import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { RequireAuth } from '../../../components/RequireAuth';
import { ClanForm } from '../../../components/ClanForm';
import { NotOwner } from '../../../components/NotOwner';
import { ErrorState, LoadingState, NavScreen, goBack } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useChat } from '../../../lib/chat';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/errors';
import { useAsync } from '../../../lib/useAsync';

export default function EditClanScreen() {
  return <RequireAuth><EditClan /></RequireAuth>;
}

function EditClan() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { reload } = useChat();
  const { data, error, loading, reload: retry } = useAsync(() => api.clan(id), [id]);
  if (loading) return <LoadingState />;
  if (error || !data) return <NavScreen><ErrorState message={errorMessage(error, t)} onRetry={retry} /></NavScreen>;
  if (data.myRole !== 'leader') return <NotOwner fallback={`/clan/${id}`} />;
  return (
    <ClanForm
      clan={data}
      fallback={`/clan/${id}`}
      onSaved={() => {
        reload(); // clan chat title/logo
        goBack(`/clan/${id}`);
      }}
    />
  );
}
