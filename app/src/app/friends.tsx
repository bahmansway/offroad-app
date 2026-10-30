import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  EmptyState, ErrorState, LoadingState, NavScreen, PillButton, SearchField, Section, SegmentedControl, Txt,
} from '../components/ui';
import { PersonCell } from '../components/ChatRows';
import { RequireAuth } from '../components/RequireAuth';
import { api } from '../lib/api';
import { useChat } from '../lib/chat';
import { useI18n } from '../lib/i18n';
import { errorMessage } from '../lib/errors';
import { confirmAsync } from '../lib/dialogs';
import { formatDate } from '../lib/format';
import { successFeedback } from '../lib/haptics';
import { addRequest, filterByName, friendErrorMessage, removeRequest } from '../lib/friendsLogic';
import type { FriendItem, FriendRequest } from '../lib/types';

type Tab = 'friends' | 'in' | 'out';

export default function FriendsScreen() {
  return <RequireAuth><Friends /></RequireAuth>;
}

function Friends() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const { t } = useI18n();
  const chat = useChat();
  const [tab, setTab] = useState<Tab>(params.tab === 'in' || params.tab === 'out' ? params.tab : 'friends');
  const [friends, setFriends] = useState<FriendItem[] | null>(null);
  const [incoming, setIncoming] = useState<FriendRequest[] | null>(null);
  const [outgoing, setOutgoing] = useState<FriendRequest[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoadError(null);
    try {
      const [f, i, o] = await Promise.all([api.friends(), api.friendRequests('in'), api.friendRequests('out')]);
      if (my !== seq.current) return;
      setFriends(f.items);
      setIncoming(i.items);
      setOutgoing(o.items);
    } catch (e) {
      if (my === seq.current) setLoadError(e);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // live: a new request arrives, or someone accepted mine
  useEffect(() => {
    const offs = [
      chat.on('friendRequest', (r) => setIncoming((l) => (l ? addRequest(l, r) : l))),
      chat.on('friendAccepted', () => load()),
    ];
    return () => offs.forEach((off) => off());
  }, [chat, load]);

  async function act(key: string, fn: () => Promise<unknown>, ok: string, after: () => void) {
    setBusy(key);
    setNote(null);
    try {
      await fn();
      after();
      successFeedback();
      setNote({ text: ok, error: false });
    } catch (e) {
      setNote({ text: friendErrorMessage(e, t, (x) => errorMessage(x, t)), error: true });
      load();
    } finally {
      setBusy(null);
      chat.refreshUnread();
    }
  }

  const accept = (r: FriendRequest) => act(`ok:${r.id}`, () => api.acceptFriendRequest(r.id), t('friends.acceptedNow', { name: r.from.displayName }), () => {
    setIncoming((l) => (l ? removeRequest(l, r.id) : l));
    load();
  });
  const decline = (r: FriendRequest) => act(`no:${r.id}`, () => api.declineFriendRequest(r.id), t('friends.declinedNote'), () => {
    setIncoming((l) => (l ? removeRequest(l, r.id) : l));
  });
  const cancel = async (r: FriendRequest) => {
    if (!(await confirmAsync(t('friends.cancelConfirm', { name: r.to.displayName }), t('friends.cancelRequest'), t('common.cancel'), { destructive: true }))) return;
    act(`cx:${r.id}`, () => api.cancelFriendRequest(r.id), t('friends.cancelledNote'), () => {
      setOutgoing((l) => (l ? removeRequest(l, r.id) : l));
    });
  };

  const inCount = incoming?.length ?? 0;
  const loaded = friends !== null && incoming !== null && outgoing !== null;
  const shown = friends ? filterByName(friends, query) : [];

  return (
    <NavScreen title={t('friends.title')} fallback="/profile">
      <SegmentedControl<Tab>
        label={t('friends.tabsLabel')}
        value={tab}
        onChange={(v) => { setTab(v); setNote(null); }}
        style={{ alignSelf: 'stretch' }}
        options={[
          { value: 'friends', label: t('friends.tabFriends') },
          { value: 'in', label: inCount ? t('friends.tabIncomingCount', { count: inCount }) : t('friends.tabIncoming') },
          { value: 'out', label: t('friends.tabOutgoing') },
        ]}
      />
      {note ? (
        <Txt variant="footnote" tone={note.error ? 'destructive' : 'label2'} center role={note.error ? 'alert' : undefined} accessibilityLiveRegion="polite">{note.text}</Txt>
      ) : null}
      {loadError && !loaded ? <ErrorState message={errorMessage(loadError, t)} onRetry={load} /> : !loaded ? <LoadingState inline /> : null}

      {loaded && tab === 'friends' ? (
        friends!.length === 0 ? (
          <EmptyState icon="people" title={t('friends.noFriendsTitle')} text={t('friends.noFriendsText')} actionLabel={t('friends.findDrivers')} onAction={() => router.push('/search')} />
        ) : (
          <View style={{ gap: 16 }}>
            <SearchField value={query} onChangeText={setQuery} placeholder={t('friends.search')} label={t('friends.search')} />
            {shown.length ? (
              <Section header={t('friends.count', { count: friends!.length })}>
                {shown.map((f) => (
                  <PersonCell
                    key={f.user.id}
                    user={f.user}
                    subtitle={t('friends.since', { date: formatDate(f.since) })}
                    onPress={() => router.push(`/user/${f.user.id}`)}
                  />
                ))}
              </Section>
            ) : <Txt variant="subhead" tone="label2" center>{t('friends.noMatch', { q: query.trim() })}</Txt>}
          </View>
        )
      ) : null}

      {loaded && tab === 'in' ? (
        incoming!.length ? (
          <Section header={t('friends.tabIncoming')}>
            {incoming!.map((r) => (
              <PersonCell
                key={r.id}
                user={r.from}
                subtitle={formatDate(r.createdAt)}
                onPress={() => router.push(`/user/${r.from.id}`)}
                accessibilityLabel={t('friends.incomingNote', { name: r.from.displayName })}
                right={
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <PillButton title={t('friends.decline')} variant="gray" size="small" style={{ paddingHorizontal: 12 }}
                      loading={busy === `no:${r.id}`} disabled={!!busy}
                      accessibilityLabel={t('friends.declineA11y', { name: r.from.displayName })} onPress={() => decline(r)} />
                    <PillButton title={t('friends.accept')} size="small" style={{ paddingHorizontal: 12 }}
                      loading={busy === `ok:${r.id}`} disabled={!!busy}
                      accessibilityLabel={t('friends.acceptA11y', { name: r.from.displayName })} onPress={() => accept(r)} />
                  </View>
                }
              />
            ))}
          </Section>
        ) : <EmptyState icon="invite" title={t('friends.noIncoming')} contour={false} />
      ) : null}

      {loaded && tab === 'out' ? (
        outgoing!.length ? (
          <Section header={t('friends.tabOutgoing')}>
            {outgoing!.map((r) => (
              <PersonCell
                key={r.id}
                user={r.to}
                subtitle={t('friends.sentAt', { date: formatDate(r.createdAt) })}
                onPress={() => router.push(`/user/${r.to.id}`)}
                right={
                  <PillButton title={t('common.cancel')} variant="gray" size="small" style={{ paddingHorizontal: 12 }}
                    loading={busy === `cx:${r.id}`} disabled={!!busy}
                    accessibilityLabel={t('friends.cancelA11y', { name: r.to.displayName })} onPress={() => cancel(r)} />
                }
              />
            ))}
          </Section>
        ) : <EmptyState icon="userClock" title={t('friends.noOutgoing')} contour={false} />
      ) : null}
    </NavScreen>
  );
}
