import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Screen } from '../../components/Screen';
import { CarRow } from '../../components/CarRow';
import { Body, Button, ErrorState, H1, H2, Muted } from '../../components/ui';
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

  return (
    <Screen>
      <H1>{t('garage.title')}</H1>

      <H2>{t('garage.myCars')}</H2>
      {offline && !user ? <Muted>{t('errors.offline')}</Muted> : user ? (
        <View style={{ gap: 10 }}>
          {mine?.length === 0 ? <Muted>{t('garage.noCars')}</Muted> : null}
          {mine?.map((c) => <CarRow key={c.id} car={c} onPress={() => router.push(`/car/${c.id}`)} />)}
          <Button title={t('garage.addCar')} icon="plus" onPress={() => router.push('/car/new')} />
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Body>{t('garage.loginPrompt')}</Body>
          <Button title={t('common.login')} onPress={() => router.push('/login')} />
        </View>
      )}

      <H2 style={{ marginTop: 8 }}>{t('garage.community')}</H2>
      {error ? <ErrorState message={errorMessage(error, t)} onRetry={load} /> : null}
      {latest?.length === 0 ? <Muted>{t('garage.noCommunity')}</Muted> : null}
      <View style={{ gap: 10 }}>
        {latest?.map((c) => <CarRow key={c.id} car={c} showOwner onPress={() => router.push(`/car/${c.id}`)} />)}
      </View>
    </Screen>
  );
}
