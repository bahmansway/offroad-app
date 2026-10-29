import React, { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { EmptyState, ErrorState, LoadingState, NavScreen, goBack } from '../../../components/ui';
import { RequireAuth } from '../../../components/RequireAuth';
import { EventForm } from '../../../components/EventForm';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useI18n } from '../../../lib/i18n';
import { useAsync } from '../../../lib/useAsync';
import { errorMessage } from '../../../lib/errors';
import { successFeedback } from '../../../lib/haptics';
import { eventPayload, formFromEvent } from '../../../lib/eventLogic';

export default function EditEventScreen() {
  return <RequireAuth><EditEvent /></RequireAuth>;
}

function EditEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { user } = useAuth();
  const q = useAsync(async () => {
    const [ev, profile] = await Promise.all([api.event(id), api.user(user!.id).catch(() => null)]);
    return { ev, clan: profile?.clan ?? null };
  }, [id, user?.id]);
  const initial = useMemo(() => (q.data ? formFromEvent(q.data.ev) : null), [q.data]);

  if (q.loading && !q.data) return <LoadingState />;
  if (q.error || !q.data || !initial) return <NavScreen fallback="/events"><ErrorState message={errorMessage(q.error, t)} onRetry={q.reload} /></NavScreen>;
  const ev = q.data.ev;
  if (!ev.canEdit) {
    return <NavScreen fallback={`/event/${id}`}><EmptyState icon="lock" title={t('events.errors.started')} /></NavScreen>;
  }
  return (
    <EventForm
      mode="edit"
      initial={initial}
      initialSpotName={ev.spot?.name ?? null}
      myClan={q.data.clan ?? (ev.clan ? { name: ev.clan.name } : null)}
      minCars={ev.carCount}
      onBack={() => goBack(`/event/${id}`)}
      onSubmit={async (f) => {
        await api.updateEvent(id, eventPayload(f));
        successFeedback();
        goBack(`/event/${id}`);
      }}
    />
  );
}
