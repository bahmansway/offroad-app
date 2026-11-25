import React, { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { NavScreen, SearchField } from '../components/ui';
import { SearchResults } from '../components/SearchResults';
import { useChat } from '../lib/chat';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useSearch } from '../lib/useSearch';

/** People / clans / my chats search, opened from the Home header. */
export default function SearchScreenKeyed() {
  const { user } = useAuth();
  return <SearchScreen key={user?.id ?? 'anon'} />;
}

function SearchScreen() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { conversations } = useChat();
  const params = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(typeof params.q === 'string' ? params.q.slice(0, 80) : '');
  const search = useSearch(query, user ? conversations : null, user?.id ?? null);
  return (
    <NavScreen title={t('search.title')} fallback="/">
      <SearchField value={query} onChangeText={setQuery} placeholder={t('search.placeholder')} label={t('search.label')} autoFocus />
      <SearchResults search={search} raw={query} />
    </NavScreen>
  );
}
