import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CarCell, photoUri } from '../../components/Rows';
import { Avatar, Card, Cell, EmptyState, ErrorState, Icon, LoadingState, NavScreen, PillButton, Section, Txt, useTheme } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useAsync } from '../../lib/useAsync';
import { chatErrorMessage, errorMessage, inviteErrorMessage } from '../../lib/errors';
import { canInviteUser, clanTitleOf, titleKey } from '../../lib/permissions';
import { applyFriendChange, applyFriendEvent, friendButtonState, friendErrorMessage, type FriendChange } from '../../lib/friendsLogic';
import { MoreMenu, type SheetAction } from '../../components/ActionSheet';
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
  const [, setBlockBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [invited, setInvited] = useState(false);
  const [friendBusy, setFriendBusy] = useState<string | null>(null);

  // live: they sent me a request / accepted mine while the page is open
  useEffect(() => {
    const offs = [
      chat.on('friendRequest', (r) => setData((cur) => (cur ? applyFriendEvent(cur, { type: 'request', request: r }) : cur))),
      chat.on('friendAccepted', (a) => {
        if (!sameId(a.user.id, id)) return;
        setData((cur) => (cur ? applyFriendEvent(cur, { type: 'accepted', userId: a.user.id }) : cur));
        setNote({ text: t('friends.acceptedNow', { name: a.user.displayName }), error: false });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [chat, setData, id, t]);
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

  /** Run a friend action, then update the buttons from its result. */
  async function friendAct(key: string, fn: () => Promise<FriendChange>, ok: (name: string) => string) {
    if (!me) return router.push('/login');
    setFriendBusy(key);
    setNote(null);
    try {
      const change = await fn();
      setData((cur) => (cur ? applyFriendChange(cur, change) : cur));
      successFeedback();
      setNote({ text: change.type === 'sent' && change.result.status === 'friends' ? t('friends.acceptedNow', { name: u!.displayName }) : ok(u!.displayName), error: false });
    } catch (e) {
      setNote({ text: friendErrorMessage(e, t, (x) => errorMessage(x, t)), error: true });
      reload(); // the state moved on (they cancelled, accepted, blocked …)
    } finally {
      setFriendBusy(null);
      chat.refreshUnread();
    }
  }
  const addFriend = () => friendAct('add', async () => ({ type: 'sent', result: await api.sendFriendRequest(u!.id) }), (name) => t('friends.requestSent', { name }));
  const acceptFriend = (rid: string) => friendAct('accept', async () => { await api.acceptFriendRequest(rid); return { type: 'accepted' }; }, (name) => t('friends.acceptedNow', { name }));
  const declineFriend = (rid: string) => friendAct('decline', async () => { await api.declineFriendRequest(rid); return { type: 'declined' }; }, () => t('friends.declinedNote'));
  const cancelFriend = async (rid: string | null) => {
    if (!rid) return reload();
    if (!(await confirmAsync(t('friends.cancelConfirm', { name: u!.displayName }), t('friends.cancelRequest'), t('common.cancel'), { destructive: true }))) return;
    friendAct('cancel', async () => { await api.cancelFriendRequest(rid); return { type: 'cancelled' }; }, () => t('friends.cancelledNote'));
  };
  const unfriend = async () => {
    if (!(await confirmAsync(t('friends.unfriendConfirm', { name: u!.displayName }), t('friends.unfriend'), t('common.cancel'), { destructive: true }))) return;
    friendAct('unfriend', async () => { await api.unfriend(u!.id); return { type: 'unfriended' }; }, (name) => t('friends.unfriended', { name }));
  };

  async function toggleBlock() {
    if (!me) return router.push('/login');
    const blocking = !u!.isBlocked;
    if (blocking && !(await confirmAsync(t('profile.blockConfirm', { name: u!.displayName }), t('profile.block'), t('common.cancel'), { destructive: true }))) return;
    setBlockBusy(true);
    setNote(null);
    try {
      if (blocking) await api.block(u!.id);
      else await api.unblock(u!.id);
      // blocking also ends the friendship and drops requests (server side)
      setData({ ...u!, isBlocked: blocking, ...(blocking ? { friendship: 'none' as const, requestId: null, friendCount: u!.friendship === 'friends' ? Math.max(0, (u!.friendCount ?? 1) - 1) : u!.friendCount } : {}) });
      setNote({ text: blocking ? t('profile.blocked') : t('profile.unblocked'), error: false });
      chat.reload(); // hidden messages change the list
    } catch (e) {
      setNote({ text: errorMessage(e, t), error: true });
    } finally {
      setBlockBusy(false);
    }
  }

  const fb = friendButtonState(u, me?.id);
  const menu: SheetAction[] = isMe ? [] : [
    ...(fb.kind === 'friends' ? [{ label: t('friends.unfriend'), destructive: true, onPress: unfriend }] : []),
    { label: u.isBlocked ? t('profile.unblock') : t('profile.block'), destructive: !u.isBlocked, onPress: toggleBlock },
    { label: t('profile.report'), destructive: true, onPress: () => router.push(me ? { pathname: '/report', params: { targetType: 'user', targetId: String(u.id) } } : '/login') },
  ];
  const friendLine = [
    typeof u.friendCount === 'number' ? t('friends.count', { count: u.friendCount }) : null,
    !isMe && (u.mutualFriends ?? 0) > 0 ? t('friends.mutual', { count: u.mutualFriends! }) : null,
  ].filter(Boolean).join(' · ');
  const clanTitle = u.clan ? t(titleKey(clanTitleOf(u.clan))) : '';
  const messageBtn = (variant: 'filled' | 'tinted') => (
    <PillButton title={t('profile.sendMessage')} icon="message" variant={variant} size="medium" onPress={message} loading={dmBusy} disabled={!!u.isBlocked} style={{ flex: 1 }} />
  );
  let actions: React.ReactNode;
  switch (fb.kind) {
    case 'login':
    case 'add':
      actions = (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <PillButton title={t('friends.add')} icon="invite" size="medium" onPress={addFriend} loading={friendBusy === 'add'} style={{ flex: 1 }} />
          {messageBtn('tinted')}
        </View>
      );
      break;
    case 'outgoing':
      actions = (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <PillButton title={t('friends.sent')} icon="userClock" variant="gray" size="medium" onPress={() => cancelFriend(fb.requestId)}
            loading={friendBusy === 'cancel'} accessibilityHint={t('friends.sentHint')} accessibilityLabel={`${t('friends.sent')}. ${t('friends.sentHint')}`} style={{ flex: 1 }} />
          {messageBtn('tinted')}
        </View>
      );
      break;
    case 'incoming':
      actions = (
        <View style={{ gap: 10 }}>
          <Txt variant="subhead" center>{t('friends.incomingNote', { name: u.displayName })}</Txt>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <PillButton title={t('friends.decline')} variant="gray" size="medium" onPress={() => fb.requestId ? declineFriend(fb.requestId) : reload()}
              loading={friendBusy === 'decline'} disabled={!!friendBusy} accessibilityLabel={t('friends.declineA11y', { name: u.displayName })} style={{ flex: 1 }} />
            <PillButton title={t('friends.accept')} icon="check" size="medium" onPress={() => fb.requestId ? acceptFriend(fb.requestId) : reload()}
              loading={friendBusy === 'accept'} disabled={!!friendBusy} accessibilityLabel={t('friends.acceptA11y', { name: u.displayName })} style={{ flex: 1 }} />
          </View>
          {messageBtn('tinted')}
        </View>
      );
      break;
    case 'friends':
      actions = (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: c.forestSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12 }}
            accessible accessibilityLabel={t('friends.youAreFriends')}>
            <Icon name="userCheck" size={18} color={c.forestText} strokeWidth={2.4} />
            <Txt variant="headline" color={c.forestText} numberOfLines={1}>{t('friends.youAreFriends')}</Txt>
          </View>
          {messageBtn('filled')}
        </View>
      );
      break;
    default:
      actions = messageBtn('filled');
  }

  return (
    <NavScreen right={menu.length ? <MoreMenu actions={menu} glass={false} title={u.displayName} label={t('friends.menu', { name: u.displayName })} /> : null}>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <Avatar uri={photoUri(u.avatarUrl)} name={u.displayName} size={96} />
        <Txt variant="title1" accessibilityRole="header" center>{u.displayName}</Txt>
        {u.city || u.clan ? (
          <Txt variant="subhead" tone="label2" center>{[u.city, u.clan ? `${u.clan.name} [${u.clan.tag}]` : null].filter(Boolean).join(' · ')}</Txt>
        ) : null}
        {friendLine ? <Txt variant="footnote" tone="label2" center>{friendLine}</Txt> : null}
        {u.bio ? <Txt variant="subhead" center style={{ maxWidth: 420 }}>{u.bio}</Txt> : null}
      </View>

      {!isMe ? (
        <View style={{ gap: 6 }}>
          {actions}
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
            subtitle={`[${u.clan.tag}] · ${clanTitle}`}
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
