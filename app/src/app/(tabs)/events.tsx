import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { EmptyState, ErrorState, LargeTitleScreen, LoadingState, PillButton, SegmentedControl } from '../../components/ui';
import { EventCard } from '../../components/EventCard';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useChat } from '../../lib/chat';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/errors';
import type { EventScope, EventSummary } from '../../lib/types';

const PAGE = 20;

export default function EventsTab() {
  const { t } = useI18n();
  const { user } = useAuth();
  const chat = useChat();
  const [scope, setScope] = useState<EventScope>('upcoming');
  const [items, setItems] = useState<EventSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [more, setMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  /** Only the newest request may fill the list (switching tabs quickly). */
  const load = useCallback(async (s: EventScope) => {
    const id = ++seq.current;
    setError(null);
    if (s === 'mine' && !user) {
      setItems([]);
      setCursor(null);
      return;
    }
    try {
      const r = await api.events({ scope: s, limit: PAGE });
      if (id !== seq.current) return;
      setItems(r.items);
      setCursor(r.nextCursor);
    } catch (e) {
      if (id === seq.current) setError(e);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(scopeRef.current); }, [load]));
  useEffect(() => chat.on('eventUpdated', () => load(scopeRef.current)), [chat, load]);

  function change(s: EventScope) {
    setScope(s);
    setItems(null);
    setCursor(null);
    load(s);
  }

  async function loadMore() {
    if (!cursor || more) return;
    const id = seq.current;
    setMore(true);
    try {
      const r = await api.events({ scope, limit: PAGE, cursor });
      if (id !== seq.current) return;
      setItems((cur) => {
        const have = new Set((cur ?? []).map((e) => String(e.id)));
        return [...(cur ?? []), ...r.items.filter((e) => !have.has(String(e.id)))];
      });
      setCursor(r.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setMore(false);
    }
  }

  const create = () => router.push(user ? '/event/new' : '/login');
  const empty = scope === 'upcoming'
    ? { title: t('events.emptyUpcomingTitle'), text: t('events.emptyUpcomingText') }
    : scope === 'mine'
      ? { title: t('events.emptyMineTitle'), text: t('events.emptyMineText') }
      : { title: t('events.emptyPastTitle'), text: undefined };

  return (
    <LargeTitleScreen
      title={t('events.title')}
      right={<PillButton title={t('events.createShort')} icon="plus" variant="tinted" size="small" onPress={create} accessibilityLabel={t('events.create')} />}
      onRefresh={async () => { setRefreshing(true); await load(scope); setRefreshing(false); }}
      refreshing={refreshing}
    >
      <SegmentedControl
        label={t('events.segLabel')}
        value={scope}
        onChange={change}
        options={[
          { value: 'upcoming', label: t('events.upcoming') },
          { value: 'mine', label: t('events.mine') },
          { value: 'past', label: t('events.past') },
        ]}
        style={{ alignSelf: 'stretch' }}
      />
      {scope === 'mine' && !user ? (
        <EmptyState icon="lock" title={t('events.loginMine')} actionLabel={t('common.login')} onAction={() => router.push('/login')} />
      ) : error && !items ? (
        <ErrorState message={errorMessage(error, t)} onRetry={() => load(scope)} />
      ) : items === null ? (
        <LoadingState inline />
      ) : items.length === 0 ? (
        <EmptyState
          icon="events"
          title={empty.title}
          text={empty.text}
          actionLabel={scope !== 'past' ? t('events.create') : undefined}
          onAction={scope !== 'past' ? create : undefined}
        />
      ) : (
        <View style={{ gap: 10 }}>
          {items.map((e) => <EventCard key={e.id} event={e} />)}
          {cursor ? <PillButton title={t('events.loadMore')} variant="gray" onPress={loadMore} loading={more} /> : null}
        </View>
      )}
    </LargeTitleScreen>
  );
}
