import React, { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { View } from 'react-native';
import { Cell, EmptyState, ErrorState, LoadingState, NavScreen, PillButton, SearchField, Section, Txt } from '../components/ui';
import { ClanCell, ClanLogo } from '../components/ClanBits';
import { useChat } from '../lib/chat';
import { formatDate } from '../lib/format';
import { successFeedback } from '../lib/haptics';
import { acceptInviteErrorMessage } from '../lib/errors';
import type { MyClanInvite } from '../lib/types';
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

  const chat = useChat();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  useFocusEffect(useCallback(() => { chat.reloadInvites(); }, [chat.reloadInvites]));

  async function answer(inv: MyClanInvite, accept: boolean) {
    setBusy(`${accept ? 'a' : 'd'}:${inv.id}`);
    setNote(null);
    try {
      if (accept) {
        const clan = await api.acceptInvite(inv.id);
        successFeedback();
        setNote({ text: t('clan.accepted', { name: clan.name }), error: false });
        chat.reload(); // the clan chat appears
      } else {
        await api.declineInvite(inv.id);
        setNote({ text: t('clan.declined'), error: false });
      }
    } catch (e) {
      setNote({ text: acceptInviteErrorMessage(e, t), error: true });
    } finally {
      setBusy(null);
      await chat.reloadInvites();
      load(qRef.current);
    }
  }

  const mine = items?.find((c) => c.myRole === 'leader' || c.myRole === 'officer' || c.myRole === 'member');
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
      {user && chat.invites?.length ? (
        <Section header={t('clan.incoming')}>
          {chat.invites.map((inv) => (
            <View key={inv.id}>
              <Cell
                title={`${inv.clan.name} [${inv.clan.tag}]`}
                subtitle={inv.invitedBy
                  ? t('clan.invitedBy', { name: inv.invitedBy.displayName, date: formatDate(inv.expiresAt) })
                  : t('clan.invitedNoName', { date: formatDate(inv.expiresAt) })}
                left={<ClanLogo clan={inv.clan} size={44} />}
                onPress={() => router.push(`/clan/${inv.clan.id}`)}
                accessibilityRole="link"
                last
              />
              <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12, paddingLeft: 74 }}>
                <PillButton title={t('clan.decline')} variant="gray" size="small" style={{ flex: 1 }}
                  accessibilityLabel={t('clan.declineA11y', { name: inv.clan.name })}
                  loading={busy === `d:${inv.id}`} disabled={!!busy} onPress={() => answer(inv, false)} />
                <PillButton title={t('clan.accept')} size="small" style={{ flex: 1 }}
                  accessibilityLabel={t('clan.acceptA11y', { name: inv.clan.name })}
                  loading={busy === `a:${inv.id}`} disabled={!!busy} onPress={() => answer(inv, true)} />
              </View>
            </View>
          ))}
        </Section>
      ) : null}
      {note ? (
        <Txt variant="subhead" tone={note.error ? 'destructive' : 'label2'} center role={note.error ? 'alert' : undefined} accessibilityLiveRegion="polite">{note.text}</Txt>
      ) : null}
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
