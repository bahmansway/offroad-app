import React from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, TopBar } from '../../components/Screen';
import { CarRow } from '../../components/CarRow';
import { Button, Card, ErrorState, Eyebrow, H1, H2, Loading, Muted } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useAsync } from '../../lib/useAsync';
import { errorMessage } from '../../lib/errors';
import { formatDate, sameId } from '../../lib/format';

export default function UserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { user: me } = useAuth();
  const { data: u, error, loading, reload } = useAsync(() => api.user(id), [id]);

  if (loading) return <Loading />;
  if (error || !u) return <Screen><TopBar /><ErrorState message={errorMessage(error, t)} onRetry={reload} /></Screen>;

  const isMe = sameId(me?.id, u.id);
  return (
    <Screen>
      <TopBar />
      <H1>{u.displayName}</H1>
      <Card style={{ flexDirection: 'row', gap: 24 }}>
        <View style={{ gap: 2 }}>
          <Eyebrow>{t('profile.memberSince')}</Eyebrow>
          <Muted>{formatDate(u.createdAt)}</Muted>
        </View>
        <View style={{ gap: 2 }}>
          <Eyebrow>{t('profile.spots')}</Eyebrow>
          <Muted>{String(u.spotCount)}</Muted>
        </View>
      </Card>
      <H2>{t('profile.cars')}</H2>
      {u.cars.length === 0 ? <Muted>{t('profile.noCars')}</Muted> : null}
      <View style={{ gap: 10 }}>
        {u.cars.map((c) => <CarRow key={c.id} car={c} onPress={() => router.push(`/car/${c.id}`)} />)}
      </View>
      {!isMe ? (
        <Button
          title={t('profile.report')}
          icon="flag"
          variant="secondary"
          onPress={() => router.push(me ? { pathname: '/report', params: { targetType: 'user', targetId: String(u.id) } } : '/login')}
        />
      ) : null}
    </Screen>
  );
}
