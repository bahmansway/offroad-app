import React, { useState } from 'react';
import { NavScreen, SearchField } from '../components/ui';
import { SearchResults } from '../components/SearchResults';
import { useChat } from '../lib/chat';
import { useI18n } from '../lib/i18n';
import { useSearch } from '../lib/useSearch';

/** People / clans / my chats search, opened from the Kəşf et header. */
export default function SearchScreen() {
  const { t } = useI18n();
  const { conversations } = useChat();
  const [query, setQuery] = useState('');
  const search = useSearch(query, conversations);
  return (
    <NavScreen title={t('search.title')} fallback="/">
      <SearchField value={query} onChangeText={setQuery} placeholder={t('search.placeholder')} label={t('search.label')} autoFocus />
      <SearchResults search={search} raw={query} />
    </NavScreen>
  );
}
