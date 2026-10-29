import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CarCell, photoUri } from '../../components/Rows';
import { Avatar, Card, Cell, EmptyState, ErrorState, LoadingState, NavScreen, PillButton, Section, Txt, useTheme } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useAsync } from '../../lib/useAsync';
import { chatErrorMessage, errorMessage, inviteErrorMessage } from '../../lib/errors';
import { canInviteUser } from '../../lib/permissions';
import { successFeedback } from '../../lib/haptics';
import { formatDate, sameId } from '../../lib/format';
import { HAIRLINE } from '../../lib/theme';
import { getSendMessageHandler } from '../../lib/chatHooks';
import { confirmAsync } from '../../lib/dialogs';
import { useChat } from '../../lib/chat';
import { ClanLogo } from '../../components/ClanBits';

export default function UserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { c } = useTheme();
  const { user: me } = useAuth();
  const { data: u, setData, error, loading, reload } = useAsync(() => api.user(id), [id]);
  const chat = useChat();
  const [soon, setSoon] = useState(false);
  const [dmBusy, setDmBusy] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [invited, setInvited] = useState(false);
  // my own clan + role decides whether "Invite to clan" shows
  const mine = useAsync(async () => (me && !sameId(me.id, id) ? (await api.user(me.id)).clan ?? null : null), [me?.id, id]);

  if (loading) return <LoadingState />;
  if (error || !u) return <NavScreen><ErrorState message={errorMessage(error, t)} onRetry={reload} /></NavScreen>;

  const isMe = sameId(me?.id, u.id);
  const current = u.currentCar ?? null;
  const others = u.cars.filter((car) => !sameId(car.id, current?.id));

  async function message() {
    if (!me) return router.push('/login');
    const h = getSendMessageHandler();
    if (!h) return setSoon(true);
    setDmBusy(true);
    setNote(null);
    try {
      await h(u!);
    } catch (e) {
      setNote({ text: chatErrorMessage(e, t), error: true });
    } finally {
      setDmBusy(false);
    }
  }

  async function invite() {
    const myClan = mine.data;
    if (!myClan) return;
    setInviteBusy(true);
    setNote(null);
    try {
      await api.inviteToClan(myClan.id, u!.id);
      successFeedback();
      setInvited(true);
      setNote({ text: t('clan.inviteSent', { name: u!.displayName }), error: false });
    } catch (e) {
      setNote({ text: inviteErrorMessage(e, t), error: true });
    } finally {
      setInviteBusy(false);
    }
  }

  async function toggleBlock() {
    if (!me) return router.push('/login');
    const blocking = !u!.isBlocked;
    if (blocking && !(await confirmAsync(t('profile.blockConfirm', { name: u!.displayName }), t('profile.block'), t('common.cancel')))) return;
    setBlockBusy(true);
    setNote(null);
    try {
      if (blocking) await api.block(u!.id);
      else await api.unblock(u!.id);
      setData({ ...u!, isBlocked: blocking });
      setNote({ text: blocking ? t('profile.blocked') : t('profile.unblocked'), error: false });
      chat.reload(); // hidden messages change the list
    } catch (e) {
      setNote({ text: errorMessage(e, t), error: true });
    } finally {
      setBlockBusy(false);
    }
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
          <PillButton title={t('profile.sendMessage')} icon="message" onPress={message} loading={dmBusy} disabled={!!u.isBlocked} />
          {canInviteUser(mine.data, u, me?.id) ? (
            <PillButton
              title={t('clan.inviteToClan')}
              icon="invite"
              variant="tinted"
              onPress={invite}
              loading={inviteBusy}
              disabled={invited}
              accessibilityLabel={`${t('clan.inviteToClan')}: ${mine.data!.name}`}
            />
          ) : null}
          {soon ? <Txt variant="footnote" tone="label2" center accessibilityLiveRegion="polite">{t('profile.messageSoon')}</Txt> : null}
          {note ? (
            <Txt variant="footnote" tone={note.error ? 'destructive' : 'label2'} center role={note.error ? 'alert' : undefined} accessibilityLiveRegion="polite">{note.text}</Txt>
          ) : u.isBlocked ? <Txt variant="footnote" tone="label2" center>{t('profile.blocked')}</Txt> : null}
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

      {u.clan ? (
        <Section header={t('clan.clanHeader')}>
          <Cell
            title={u.clan.name}
            subtitle={`[${u.clan.tag}] · ${u.clan.role === 'leader' ? t('clan.leader') : u.clan.role === 'officer' ? t('clan.officer') : t('clan.member')}`}
            left={<ClanLogo clan={u.clan} size={40} />}
            onPress={() => router.push(`/clan/${u.clan!.id}`)}
            accessibilityRole="link"
          />
        </Section>
      ) : null}

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
            title={u.isBlocked ? t('profile.unblock') : t('profile.block')}
            destructive={!u.isBlocked}
            action={!!u.isBlocked}
            center
            chevron={false}
            disabled={blockBusy}
            onPress={toggleBlock}
          />
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
