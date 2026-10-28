import React, { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { CarCell } from '../../components/Rows';
import { EmptyState, ErrorState, LargeTitleScreen, LoadingState, PillButton, Section } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/errors';
import { sameId } from '../../lib/format';
import type { CarSummary } from '../../lib/types';

export default function GarageScreen() {
  const { t } = useI18n();
  const { user, offline } = useAuth();
  const [mine, setMine] = useState<CarSummary[] | null>(null);
  const [latest, setLatest] = useState<CarSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, l] = await Promise.all([
        user ? api.cars(user.id) : Promise.resolve({ items: [] as CarSummary[] }),
        api.cars(),
      ]);
      setMine(m.items);
      setLatest(l.items.filter((c) => !user || !c.owner || !sameId(c.owner.id, user.id)));
    } catch (e) {
      setError(e);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const add = () => router.push(user ? '/car/add' : '/login');

  return (
    <LargeTitleScreen
      title={t('garage.title')}
      right={<PillButton title={t('garage.addShort')} icon="plus" variant="tinted" size="small" onPress={add} accessibilityLabel={t('garage.addCar')} />}
      onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
      refreshing={refreshing}
    >
      {offline && !user ? <ErrorState message={t('errors.offline')} /> : user ? (
        mine === null && !error ? <LoadingState inline /> : mine?.length === 0 ? (
          <EmptyState icon="garage" title={t('garage.noCars')} actionLabel={t('garage.addCar')} onAction={add} />
        ) : mine ? (
          <Section header={t('garage.myCars')}>
            {mine.map((c) => (
              <CarCell key={c.id} car={c} onPress={() => router.push(`/car/${c.id}`)}
                badge={sameId(user.currentCarId ?? user.currentCar?.id, c.id) ? t('garage.current') : undefined} />
            ))}
          </Section>
        ) : null
      ) : (
        <EmptyState icon="garage" title={t('garage.loginPrompt')} actionLabel={t('common.login')} onAction={() => router.push('/login')} />
      )}

      {error ? <ErrorState message={errorMessage(error, t)} onRetry={load} /> : null}
      {latest && latest.length > 0 ? (
        <Section header={t('garage.community')}>
          {latest.map((c) => <CarCell key={c.id} car={c} showOwner onPress={() => router.push(`/car/${c.id}`)} />)}
        </Section>
      ) : latest?.length === 0 ? (
        <Section header={t('garage.community')}><EmptyState icon="garage" title={t('garage.noCommunity')} /></Section>
      ) : null}
    </LargeTitleScreen>
  );
}
