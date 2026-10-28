import React, { useState } from 'react';
import { router } from 'expo-router';
import { RequireAuth } from '../../components/RequireAuth';
import { carTitle, photoUri } from '../../components/Rows';
import { Cell, EmptyState, ErrorState, FormError, LoadingState, Section, SheetScreen, Thumb, goBack } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useAsync } from '../../lib/useAsync';
import { errorMessage } from '../../lib/errors';
import { sameId } from '../../lib/format';
import { tapFeedback } from '../../lib/haptics';
import type { Id } from '../../lib/types';

/** Picks which of my cars is "current" (shown on my profile and later in chats). */
export default function CurrentCarScreen() {
  return <RequireAuth><Picker /></RequireAuth>;
}

function Picker() {
  const { t } = useI18n();
  const { user, updateUser } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.cars(user!.id), [user?.id]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const currentId = user?.currentCarId ?? user?.currentCar?.id ?? null;

  async function choose(id: Id | null) {
    if (busy) return;
    tapFeedback();
    setBusy(true);
    setFormError(null);
    try {
      const me = await api.updateMe({ currentCarId: id });
      updateUser(me);
      goBack('/profile');
    } catch (e) {
      setFormError(errorMessage(e, t));
      setBusy(false);
    }
  }

  return (
    <SheetScreen title={t('profile.chooseCurrentCar')} cancelLabel={t('common.cancel')} onBack={() => goBack('/profile')} contentStyle={{ paddingHorizontal: 16 }}>
      {loading && !data ? <LoadingState inline /> : null}
      {error ? <ErrorState message={errorMessage(error, t)} onRetry={reload} /> : null}
      {data?.items.length === 0 ? (
        <EmptyState icon="garage" title={t('garage.noCars')} actionLabel={t('garage.addCar')} onAction={() => router.replace('/car/add')} />
      ) : null}
      {data && data.items.length > 0 ? (
        <Section footer={t('profile.currentCarHint')}>
          {data.items.map((c) => (
            <Cell
              key={c.id}
              title={carTitle(c)}
              subtitle={[String(c.year), c.engine].filter(Boolean).join(' · ')}
              left={<Thumb seed={c.id} uri={photoUri(c.photoUrl)} />}
              checked={sameId(currentId, c.id)}
              accessibilityRole="radio"
              onPress={() => choose(c.id)}
              disabled={busy}
              minHeight={64}
            />
          ))}
          <Cell title={t('profile.noCurrentCar')} checked={currentId == null} accessibilityRole="radio" onPress={() => choose(null)} disabled={busy} />
        </Section>
      ) : null}
      <FormError message={formError} />
    </SheetScreen>
  );
}
