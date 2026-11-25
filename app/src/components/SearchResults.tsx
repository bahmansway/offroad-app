import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { EmptyState, ErrorState, LoadingState, Section, Txt } from './ui';
import { ClanResultCell, ConversationCell, PersonCell } from './ChatRows';
import { FollowButton } from './FollowButton';
import { useI18n } from '../lib/i18n';
import { errorMessage } from '../lib/errors';
import { hasResults } from '../lib/searchLogic';
import type { useSearch } from '../lib/useSearch';

/** Search result sections: Adamlar / Klanlar / Söhbətlər. Feed it the value of `useSearch`. */
export function SearchResults({ search, raw }: { search: ReturnType<typeof useSearch>; raw: string }) {
  const { t } = useI18n();
  const { result, loading, answered, error, retry, query } = search;
  if (!query) {
    return <Txt variant="footnote" tone="label2" center accessibilityLiveRegion="polite">{raw.trim() ? t('search.tooShort') : t('search.hint')}</Txt>;
  }
  const any = !!result && hasResults(result);
  return (
    <View style={{ gap: 20 }}>
      {result?.users.length ? (
        <Section header={t('search.people')}>
          {result.users.map((u) => (
            <PersonCell
              key={u.id}
              user={u}
              isFriend={u.isFriend}
              onPress={() => router.push(`/user/${u.id}`)}
              // v6: İzlə / İzləyirsən right in the results (hidden for me)
              right={<FollowButton user={{ id: u.id, displayName: u.displayName, isFollowing: u.isFollowing ?? u.isFriend }} />}
            />
          ))}
        </Section>
      ) : null}
      {result?.clans.length ? (
        <Section header={t('search.clans')}>
          {result.clans.map((c) => <ClanResultCell key={c.id} clan={c} />)}
        </Section>
      ) : null}
      {result?.conversations.length ? (
        <Section header={t('search.chats')}>
          {result.conversations.map((c) => <ConversationCell key={c.id} conv={c} />)}
        </Section>
      ) : null}
      {error ? <ErrorState message={errorMessage(error, t)} onRetry={retry} /> : null}
      {loading && !any ? <LoadingState inline /> : null}
      {!loading && answered && !any && !error ? (
        <EmptyState icon="search" title={t('search.none', { q: query })} contour={false} style={{ paddingVertical: 16 }} />
      ) : null}
      <Txt variant="footnote" tone="label2" center accessibilityLiveRegion="polite" style={{ height: loading ? undefined : 0, opacity: loading && any ? 1 : 0 }}>
        {loading ? t('search.searching') : ''}
      </Txt>
    </View>
  );
}
