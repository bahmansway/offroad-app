import React, { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { EmptyState, ErrorState, LoadingState, NavScreen, PillButton, SearchField, Section } from '../components/ui';
import { ClanCell } from '../components/ClanBits';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { errorMessage } from '../lib/errors';
import type { Clan } from '../lib/types';

export default function ClansScreen() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Clan[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const seq = useRef(0);
  const qRef = useRef(q);
  qRef.current = q;

  /** Only the newest request may update the list (a slow old search must not overwrite a newer one). */
  const load = useCallback(async (query: string) => {
    const id = ++seq.current;
    setError(null);
    try {
      const r = await api.clans(query.trim() || undefined);
      if (id === seq.current) setItems(r.items);
    } catch (e) {
      if (id === seq.current) setError(e);
    }
  }, []);

  // search as you type (short pause); the first load comes from the focus effect below
  const firstQ = useRef(true);
  useEffect(() => {
    if (firstQ.current) {
      firstQ.current = false;
      return;
    }
    const h = setTimeout(() => load(q), 300);
    return () => clearTimeout(h);
  }, [q, load]);
  // every time the page is shown (first open, and back from a clan page)
  useFocusEffect(useCallback(() => { load(qRef.current); }, [load]));

  const mine = items?.find((c) => c.myRole === 'leader' || c.myRole === 'member');
  const pending = items?.filter((c) => c.myRole === 'pending') ?? [];
  const others = items?.filter((c) => c !== mine && c.myRole !== 'pending') ?? [];
  const create = () => router.push(user ? '/clan/new' : '/login');

  return (
    <NavScreen
      title={t('clan.title')}
      backLabel={t('chat.title')}
      fallback="/chat"
      right={!mine ? <PillButton title={t('clan.createShort')} icon="plus" variant="tinted" size="small" onPress={create} accessibilityLabel={t('clan.create')} /> : null}
    >
      <SearchField value={q} onChangeText={setQ} placeholder={t('clan.search')} label={t('clan.search')} />
      {!user ? <EmptyState icon="lock" title={t('clan.loginPrompt')} actionLabel={t('common.login')} onAction={() => router.push('/login')} style={{ paddingVertical: 8 }} /> : null}
      {error ? <ErrorState message={errorMessage(error, t)} onRetry={() => load(q)} /> : items === null ? <LoadingState inline /> : null}
      {mine ? (
        <Section header={t('chat.myClan')}>
          <ClanCell clan={mine} onPress={() => router.push(`/clan/${mine.id}`)} />
        </Section>
      ) : null}
      {pending.length ? (
        <Section header={t('clan.requests')}>
          {pending.map((c) => <ClanCell key={c.id} clan={c} onPress={() => router.push(`/clan/${c.id}`)} />)}
        </Section>
      ) : null}
      {others.length ? (
        <Section header={t('clan.title')}>
          {others.map((c) => <ClanCell key={c.id} clan={c} onPress={() => router.push(`/clan/${c.id}`)} />)}
        </Section>
      ) : items && !mine && !pending.length ? (
        <EmptyState
          icon="profile"
          title={q.trim() ? t('clan.noResults', { q: q.trim() }) : t('clan.none')}
          actionLabel={user ? t('clan.create') : undefined}
          onAction={user ? create : undefined}
        />
      ) : null}
    </NavScreen>
  );
}
