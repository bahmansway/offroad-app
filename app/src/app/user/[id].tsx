import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CarCell, photoUri } from '../../components/Rows';
import { Avatar, Card, Cell, EmptyState, ErrorState, LoadingState, NavScreen, PillButton, Section, Txt, useTheme } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useAsync } from '../../lib/useAsync';
import { errorMessage } from '../../lib/errors';
import { formatDate, sameId } from '../../lib/format';
import { HAIRLINE } from '../../lib/theme';
import { getSendMessageHandler } from '../../lib/chatHooks';

export default function UserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { c } = useTheme();
  const { user: me } = useAuth();
  const { data: u, error, loading, reload } = useAsync(() => api.user(id), [id]);
  const [soon, setSoon] = useState(false);

  if (loading) return <LoadingState />;
  if (error || !u) return <NavScreen><ErrorState message={errorMessage(error, t)} onRetry={reload} /></NavScreen>;

  const isMe = sameId(me?.id, u.id);
  const current = u.currentCar ?? null;
  const others = u.cars.filter((car) => !sameId(car.id, current?.id));

  function message() {
    if (!me) return router.push('/login');
    const h = getSendMessageHandler();
    if (h) return h(u!);
    setSoon(true);
  }

  return (
    <NavScreen>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <Avatar uri={photoUri(u.avatarUrl)} name={u.displayName} size={96} />
        <Txt variant="title1" accessibilityRole="header" center>{u.displayName}</Txt>
        {u.city || u.clan ? (
          <Txt variant="subhead" tone="label2" center>{[u.city, u.clan ? `${u.clan.name} [${u.clan.tag}]` : null].filter(Boolean).join(' · ')}</Txt>
        ) : null}
        {u.bio ? <Txt variant="subhead" center style={{ maxWidth: 420 }}>{u.bio}</Txt> : null}
      </View>

      {!isMe ? (
        <View style={{ gap: 6 }}>
          <PillButton title={t('profile.sendMessage')} icon="message" onPress={message} />
          {soon ? <Txt variant="footnote" tone="label2" center accessibilityLiveRegion="polite">{t('profile.messageSoon')}</Txt> : null}
        </View>
      ) : (
        <PillButton title={t('profile.edit')} variant="gray" icon="edit" onPress={() => router.push('/profile/edit')} />
      )}

      <Card padded={false} style={{ flexDirection: 'row', paddingVertical: 14 }}>
        <Stat k={t('profile.memberSince')} v={formatDate(u.createdAt)} />
        <View style={{ width: HAIRLINE, backgroundColor: c.separator }} />
        <Stat k={t('profile.spots')} v={String(u.spotCount)} />
        <View style={{ width: HAIRLINE, backgroundColor: c.separator }} />
        <Stat k={t('profile.cars')} v={String(u.cars.length)} />
      </Card>

      {current ? (
        <Section header={t('profile.currentCar')}>
          <CarCell car={current} onPress={() => router.push(`/car/${current.id}`)} />
        </Section>
      ) : null}

      {others.length ? (
        <Section header={t('profile.cars')}>
          {others.map((car) => <CarCell key={car.id} car={car} onPress={() => router.push(`/car/${car.id}`)} />)}
        </Section>
      ) : !current ? (
        <EmptyState icon="garage" title={t('profile.noCars')} style={{ paddingVertical: 12 }} />
      ) : null}

      {!isMe ? (
        <Section>
          <Cell
            title={t('profile.report')}
            destructive
            center
            chevron={false}
            onPress={() => router.push(me ? { pathname: '/report', params: { targetType: 'user', targetId: String(u.id) } } : '/login')}
          />
        </Section>
      ) : null}
    </NavScreen>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }} accessible accessibilityLabel={`${k}: ${v}`}>
      <Txt variant="caption" tone="label2" center numberOfLines={1}>{k}</Txt>
      <Txt variant="headline" style={{ fontWeight: '700' }} numberOfLines={1}>{v}</Txt>
    </View>
  );
}
