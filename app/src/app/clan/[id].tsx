import React, { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  Avatar, Badge, Cell, EmptyState, ErrorState, IconButton, LoadingState, NavScreen, PillButton, Section, Txt, useTheme,
} from '../../components/ui';
import { ActionSheet, type SheetAction } from '../../components/ActionSheet';
import { ClanLogo, clanMeta } from '../../components/ClanBits';
import { EventList } from '../../components/EventCard';
import { clanPermissions, isClanMember, memberActions as allowedActions, roleBadgeKey } from '../../lib/permissions';
import { photoUri } from '../../components/Rows';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/apiClient';
import { useAuth } from '../../lib/auth';
import { useChat } from '../../lib/chat';
import { useI18n } from '../../lib/i18n';
import { clanErrorMessage, clanShouldReload, errorMessage } from '../../lib/errors';
import { confirmAsync } from '../../lib/dialogs';
import { formatDate, sameId } from '../../lib/format';
import { successFeedback } from '../../lib/haptics';
import type { Clan, ClanInvite, ClanMember, ClanRequest, EventSummary } from '../../lib/types';

export default function ClanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { c } = useTheme();
  const { user } = useAuth();
  const chat = useChat();
  const [clan, setClan] = useState<Clan | null>(null);
  const [members, setMembers] = useState<ClanMember[] | null>(null);
  const [requests, setRequests] = useState<ClanRequest[] | null>(null);
  const [requestsError, setRequestsError] = useState<unknown>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** error or success line under the action button */
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [menuFor, setMenuFor] = useState<ClanMember | null>(null);
  const [invites, setInvites] = useState<ClanInvite[] | null>(null);
  const [events, setEvents] = useState<EventSummary[] | null>(null);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const my = ++loadSeq.current;
    setLoadError(null);
    try {
      const [cl, m, ev] = await Promise.all([
        api.clan(id),
        api.clanMembers(id),
        api.clanEvents(id).then((r) => r.items).catch(() => [] as EventSummary[]),
      ]);
      if (my !== loadSeq.current) return; // a newer load (or another clan) won
      setClan(cl);
      setEvents(ev);
      setMembers(m.items);
      setGone(false);
      setRequestsError(null);
      if (clanPermissions(cl.myRole).manageRequests) {
        try {
          const [rq, inv] = await Promise.all([api.clanRequests(id), api.clanInvites(id)]);
          if (my !== loadSeq.current) return;
          setRequests(rq.items);
          setInvites(inv.items);
        } catch (e) {
          setRequests(null);
          setInvites(null);
          setRequestsError(e);
        }
      } else {
        setRequests(null);
        setInvites(null);
      }
    } catch (e) {
      if (my !== loadSeq.current) return;
      if (e instanceof ApiError && e.status === 404) setGone(true);
      else setLoadError(e);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  /** Run a clan action. On 403/404/409 the clan changed meanwhile: reload it and say so. */
  async function act(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    setNote(null);
    try {
      await fn();
      if (ok) {
        successFeedback();
        setNote({ text: ok, error: false });
      }
      await load();
      chat.reload(); // membership changes add/remove the clan chat
    } catch (e) {
      setNote({ text: clanErrorMessage(e, t), error: true });
      if (clanShouldReload(e)) {
        await load();
        chat.reload();
      }
    } finally {
      setBusy(null);
    }
  }

  if (gone) {
    return (
      <NavScreen fallback="/clans">
        <EmptyState icon="info" title={t('clan.gone')} actionLabel={t('chat.clans')} onAction={() => router.replace('/clans')} />
      </NavScreen>
    );
  }
  if (!clan) {
    return loadError
      ? <NavScreen fallback="/clans"><ErrorState message={errorMessage(loadError, t)} onRetry={load} /></NavScreen>
      : <LoadingState />;
  }

  const role = clan.myRole;
  const isLeader = role === 'leader';
  const perms = clanPermissions(role);
  const inClan = isClanMember(role);
  const alone = (members?.length ?? clan.memberCount) <= 1;

  const login = () => router.push('/login');
  const join = () => act('join', () => api.joinClan(clan.id));
  const leave = async () => {
    if ((role === 'member' || role === 'officer') && !(await confirmAsync(t('clan.leaveConfirm'), t('clan.leave'), t('common.cancel')))) return;
    act('leave', () => api.leaveClan(clan.id));
  };
  const del = async () => {
    if (!(await confirmAsync(t('clan.deleteConfirm'), t('common.delete'), t('common.cancel')))) return;
    setBusy('delete');
    setNote(null);
    try {
      await api.deleteClan(clan.id);
      chat.reload();
      router.replace('/clans');
    } catch (e) {
      setNote({ text: clanErrorMessage(e, t), error: true });
      if (clanShouldReload(e)) await load();
    } finally {
      setBusy(null);
    }
  };

  function memberActions(m: ClanMember): SheetAction[] {
    const name = m.user.displayName;
    const cid = clan!.id;
    return allowedActions(role, m.role, sameId(m.user.id, user?.id)).map((a): SheetAction => {
      switch (a) {
        case 'profile':
          return { label: t('chat.openProfile'), onPress: () => router.push(`/user/${m.user.id}`) };
        case 'promote':
          return {
            label: t('clan.promote'),
            onPress: async () => {
              if (!(await confirmAsync(t('clan.promoteConfirm', { name }), t('clan.promote'), t('common.cancel')))) return;
              act(`role:${m.user.id}`, () => api.setMemberRole(cid, m.user.id, 'officer'), t('clan.promoted', { name }));
            },
          };
        case 'demote':
          return { label: t('clan.demote'), onPress: () => act(`role:${m.user.id}`, () => api.setMemberRole(cid, m.user.id, 'member'), t('clan.demoted', { name })) };
        case 'makeLeader':
          return {
            label: t('clan.makeLeader'),
            onPress: async () => {
              if (!(await confirmAsync(t('clan.makeLeaderConfirm', { name }), t('clan.makeLeader'), t('common.cancel')))) return;
              act(`lead:${m.user.id}`, () => api.handOver(cid, m.user.id), t('clan.leaderNow', { name }));
            },
          };
        case 'remove':
          return {
            label: t('clan.remove'),
            destructive: true,
            onPress: async () => {
              if (!(await confirmAsync(t('clan.removeConfirm', { name }), t('common.remove'), t('common.cancel')))) return;
              act(`rm:${m.user.id}`, () => api.removeMember(cid, m.user.id));
            },
          };
      }
    });
  }

  let mainButton: React.ReactNode = null;
  if (!user) mainButton = <PillButton title={clan.isOpen ? t('clan.join') : t('clan.requestJoin')} onPress={login} />;
  else if (inClan) {
    mainButton = clan.conversationId
      ? <PillButton title={t('clan.openChat')} icon="chat" onPress={() => router.push(`/chat/${clan.conversationId}`)} />
      : null;
  } else if (role === 'pending') {
    mainButton = (
      <View style={{ gap: 8 }}>
        <Badge text={t('clan.pending')} />
        <PillButton title={t('clan.cancelRequest')} variant="gray" onPress={leave} loading={busy === 'leave'} />
      </View>
    );
  } else {
    mainButton = <PillButton title={clan.isOpen ? t('clan.join') : t('clan.requestJoin')} icon="plus" onPress={join} loading={busy === 'join'} />;
  }

  return (
    <NavScreen
      fallback="/clans"
      backLabel={t('clan.title')}
      right={isLeader ? <IconButton icon="edit" label={t('clan.edit')} onPress={() => router.push(`/clan/edit/${clan.id}`)} color={c.tint} /> : null}
    >
      <View style={{ alignItems: 'center', gap: 8 }}>
        <ClanLogo clan={clan} size={96} />
        <Txt variant="title1" accessibilityRole="header" center>{clan.name}</Txt>
        <Txt variant="subhead" tone="label2" center>{clanMeta(clan, t)}</Txt>
        <Badge text={clan.isOpen ? t('clan.open') : t('clan.request')} tone="gray" />
        {clan.description ? <Txt variant="subhead" center style={{ maxWidth: 460 }}>{clan.description}</Txt> : null}
      </View>

      {mainButton}
      {note ? (
        <Txt variant="subhead" tone={note.error ? 'destructive' : 'label2'} center role={note.error ? 'alert' : undefined} accessibilityLiveRegion="polite">
          {note.text}
        </Txt>
      ) : null}

      {perms.manageRequests ? (
        <Section header={t('clan.requests')} footer={role === 'officer' ? t('clan.staffTools') : undefined}>
          {requestsError ? (
            <Cell title={errorMessage(requestsError, t)} subtitle={t('common.retry')} action onPress={load} chevron={false} />
          ) : requests === null ? <LoadingState inline /> : requests.length ? requests.map((r) => (
            <Cell
              key={r.user.id}
              title={r.user.displayName}
              subtitle={formatDate(r.createdAt)}
              left={<Avatar uri={photoUri(r.user.avatarUrl)} name={r.user.displayName} size={40} />}
              chevron={false}
              accessibilityLabel={r.user.displayName}
              right={
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <PillButton title={t('clan.reject')} variant="gray" size="small" style={{ paddingHorizontal: 12 }}
                    loading={busy === `rej:${r.user.id}`} accessibilityLabel={`${t('clan.reject')}: ${r.user.displayName}`}
                    onPress={() => act(`rej:${r.user.id}`, () => api.rejectRequest(clan.id, r.user.id))} />
                  <PillButton title={t('clan.approve')} size="small" style={{ paddingHorizontal: 12 }}
                    loading={busy === `ok:${r.user.id}`} accessibilityLabel={`${t('clan.approve')}: ${r.user.displayName}`}
                    onPress={() => act(`ok:${r.user.id}`, () => api.approveRequest(clan.id, r.user.id), t('clan.approved', { name: r.user.displayName }))} />
                </View>
              }
            />
          )) : <Cell title={t('clan.noRequests')} chevron={false} />}
        </Section>
      ) : null}

      {perms.invite ? (
        <Section header={t('clan.invites')} footer={t('clan.invitesHint')}>
          {invites === null ? (requestsError ? null : <LoadingState inline />) : invites.length ? invites.map((inv) => (
            <Cell
              key={inv.id}
              title={inv.user.displayName}
              subtitle={t('clan.expires', { date: formatDate(inv.expiresAt) })}
              left={<Avatar uri={photoUri(inv.user.avatarUrl)} name={inv.user.displayName} size={40} />}
              chevron={false}
              accessibilityLabel={`${inv.user.displayName}, ${t('clan.expires', { date: formatDate(inv.expiresAt) })}`}
              right={
                <PillButton title={t('clan.revoke')} variant="gray" size="small" style={{ paddingHorizontal: 12 }}
                  loading={busy === `inv:${inv.id}`} accessibilityLabel={`${t('clan.revoke')}: ${inv.user.displayName}`}
                  onPress={async () => {
                    if (!(await confirmAsync(t('clan.revokeConfirm', { name: inv.user.displayName }), t('clan.revoke'), t('common.cancel')))) return;
                    act(`inv:${inv.id}`, () => api.revokeInvite(clan.id, inv.id));
                  }} />
              }
            />
          )) : <Cell title={t('clan.noInvites')} chevron={false} />}
        </Section>
      ) : null}

      <View style={{ gap: 10 }}>
        <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 0.2 }} accessibilityRole="header">
          {t('clan.upcomingEvents')}
        </Txt>
        {events === null ? <LoadingState inline /> : events.length ? <EventList items={events} /> : (
          <Txt variant="subhead" tone="label2" style={{ paddingHorizontal: 20 }}>{t('clan.noEvents')}</Txt>
        )}
      </View>

      <Section header={`${t('clan.members')} · ${members?.length ?? clan.memberCount}`}>
        {members === null ? <LoadingState inline /> : members.map((m) => {
          const isMe = sameId(m.user.id, user?.id);
          const badgeKey = roleBadgeKey(m.role);
          const hasMenu = allowedActions(role, m.role, isMe).length > 1;
          return (
            <Cell
              key={m.user.id}
              title={isMe ? `${m.user.displayName} (${t('chat.you')})` : m.user.displayName}
              subtitle={t('clan.since', { date: formatDate(m.joinedAt) })}
              left={<Avatar uri={photoUri(m.user.avatarUrl)} name={m.user.displayName} size={40} />}
              right={badgeKey ? <Badge text={t(badgeKey)} tone={m.role === 'leader' ? 'tint' : 'gray'} /> : undefined}
              onPress={hasMenu ? () => setMenuFor(m) : () => router.push(`/user/${m.user.id}`)}
              accessibilityLabel={`${m.user.displayName}${badgeKey ? `, ${t(badgeKey)}` : ''}`}
              accessibilityRole={hasMenu ? 'button' : 'link'}
            />
          );
        })}
      </Section>

      {inClan ? (
        <Section footer={isLeader ? (alone ? t('clan.deleteHint') : t('clan.leaderLeaveHint')) : undefined}>
          {isLeader ? (
            alone ? <Cell title={t('clan.delete')} destructive center chevron={false} onPress={del} disabled={busy === 'delete'} /> : null
          ) : (
            <Cell title={t('clan.leave')} destructive center chevron={false} onPress={leave} disabled={busy === 'leave'} />
          )}
          {isLeader && !alone ? <Cell title={t('clan.leave')} center chevron={false} disabled onPress={() => {}} /> : null}
        </Section>
      ) : null}

      {user && !isLeader ? (
        <Section>
          <Cell
            title={t('clan.report')}
            destructive
            center
            chevron={false}
            onPress={() => router.push({ pathname: '/report', params: { targetType: 'clan', targetId: String(clan.id) } })}
          />
        </Section>
      ) : null}

      <ActionSheet
        visible={!!menuFor}
        title={menuFor ? t('clan.memberActions', { name: menuFor.user.displayName }) : undefined}
        actions={menuFor ? memberActions(menuFor) : []}
        onClose={() => setMenuFor(null)}
      />
    </NavScreen>
  );
}
