import React, { useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  Avatar, Badge, Cell, EmptyState, ErrorState, IconButton, LoadingState, NavScreen, Section, SegmentedControl, Txt, useTheme,
} from '../components/ui';
import { carTitle, photoUri } from '../components/Rows';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { errorMessage } from '../lib/errors';
import { sameId } from '../lib/format';
import { font, radius, terrain } from '../lib/theme';
import {
  breakdownParts, formatPoints, meBarState, monthTitle, podiumOrder, rankText, splitBoard,
} from '../lib/leaderboardLogic';
import type { Leaderboard, LeaderboardItem, LeaderboardPeriod } from '../lib/types';

export default function LeaderboardScreen() {
  const { t, d, lang } = useI18n();
  const { c } = useTheme();
  const { user } = useAuth();
  const [period, setPeriod] = useState<LeaderboardPeriod>('month');
  const [boards, setBoards] = useState<Partial<Record<LeaderboardPeriod, Leaderboard>>>({});
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);

  const load = useCallback(async (p: LeaderboardPeriod) => {
    const my = ++seq.current;
    setError(null);
    try {
      const b = await api.leaderboard(p);
      setBoards((cur) => ({ ...cur, [p]: b }));
    } catch (e) {
      if (my === seq.current) setError(e);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(period); }, [load, period]));

  const board = boards[period];
  const me = meBarState(board, user?.id);
  const { podium, rest } = splitBoard(board?.items ?? []);

  const footer = me.kind === 'hidden' ? null : (
    <View
      style={{ backgroundColor: c.card, borderRadius: radius.card, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: c.separator }}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={me.kind === 'ranked'
        ? t('board.yourPlaceA11y', { rank: me.rank, points: formatPoints(me.points, lang) })
        : t('board.yourPlaceNone')}
    >
      <Avatar uri={photoUri(user?.avatarUrl)} name={user?.displayName ?? ''} size={36} />
      <Txt variant="subhead" style={[{ flex: 1 }, font('600')]} numberOfLines={2}>
        {me.kind === 'ranked'
          ? t('board.yourPlace', { rank: rankText(me.rank), points: formatPoints(me.points, lang) })
          : t('board.yourPlaceNone')}
      </Txt>
    </View>
  );

  return (
    <NavScreen
      title={t('board.title')}
      right={<IconButton icon="info" label={t('board.howA11y')} color={c.tint} onPress={() => router.push('/leaderboard-info')} />}
      footer={footer}
    >
      <SegmentedControl<LeaderboardPeriod>
        label={t('board.periodLabel')}
        value={period}
        onChange={setPeriod}
        style={{ alignSelf: 'stretch' }}
        options={[{ value: 'month', label: t('board.month') }, { value: 'all', label: t('board.all') }]}
      />
      {board ? (
        <Txt variant="footnote" tone="label2" center>
          {[period === 'month' ? monthTitle(board.monthStart, d.chat.months) : null, t('board.updated')].filter(Boolean).join(' · ')}
        </Txt>
      ) : null}

      {!board && error ? <ErrorState message={errorMessage(error, t)} onRetry={() => load(period)} /> : null}
      {!board && !error ? <LoadingState inline /> : null}

      {board && !board.items.length ? (
        <EmptyState
          illustration="mountain"
          title={t('board.emptyTitle')}
          text={period === 'month' ? t('board.emptyMonth') : t('board.emptyAll')}
          actionLabel={t('board.howTitle')}
          onAction={() => router.push('/leaderboard-info')}
        />
      ) : null}

      {podium.length ? <Podium items={podium} myId={user?.id} /> : null}

      {rest.length ? (
        <Section>
          {rest.map((it) => <BoardRow key={it.user.id} item={it} mine={sameId(it.user.id, user?.id)} />)}
        </Section>
      ) : null}

      {board?.items.length ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/leaderboard-info')} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Txt variant="subhead" tone="tint">{t('board.howTitle')}</Txt>
        </Pressable>
      ) : null}
    </NavScreen>
  );
}

function usePoints() {
  const { t, lang } = useI18n();
  return (n: number) => t('board.points', { points: formatPoints(n, lang) });
}

function openable(item: LeaderboardItem) {
  return item.blocked ? undefined : () => router.push(`/user/${item.user.id}`);
}

function subtitleOf(item: LeaderboardItem) {
  return [item.user.currentCar ? carTitle(item.user.currentCar) : null, item.user.clan ? `[${item.user.clan.tag}]` : null].filter(Boolean).join(' · ');
}

function itemLabel(item: LeaderboardItem, t: (k: string, p?: Record<string, string | number>) => string, lang: 'az' | 'en', mine: boolean) {
  const parts = breakdownParts(item.breakdown).map((p) => `${t(`board.breakdown.${p.key}`)} ${formatPoints(p.points, lang)}`);
  return [
    t('board.rankA11y', { rank: item.rank }),
    mine ? `${item.user.displayName} (${t('board.you')})` : item.user.displayName,
    t('board.pointsA11y', { points: formatPoints(item.points, lang) }),
    subtitleOf(item),
    parts.join(', '),
    item.blocked ? t('board.blocked') : null,
  ].filter(Boolean).join(', ');
}

/** Top 3: 2nd · 1st · 3rd on stepped blocks. */
function Podium({ items, myId }: { items: LeaderboardItem[]; myId?: string | null }) {
  const { c } = useTheme();
  const { t, lang } = useI18n();
  const pts = usePoints();
  const tones = { 1: { bg: c.tintSoft, fg: c.tintSoftText, h: 96 }, 2: terrainBlock(c, 'stone', 72), 3: terrainBlock(c, 'sand', 56) } as const;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }} accessibilityRole="list">
      {podiumOrder(items).map((it) => {
        const place = (it.rank <= 3 ? it.rank : 3) as 1 | 2 | 3;
        const tone = tones[place];
        const size = place === 1 ? 76 : 60;
        const mine = sameId(it.user.id, myId);
        const onPress = openable(it);
        return (
          <Pressable
            key={it.user.id}
            onPress={onPress}
            disabled={!onPress}
            accessibilityRole={onPress ? 'link' : undefined}
            accessibilityLabel={itemLabel(it, t, lang, mine)}
            style={({ pressed }) => [{ flex: 1, alignItems: 'center', gap: 6 }, pressed && { opacity: 0.7 }]}
          >
            <View>
              <Avatar uri={photoUri(it.user.avatarUrl)} name={it.user.displayName} size={size}
                style={mine ? { borderWidth: 3, borderColor: c.tint } : undefined} />
              <View style={{ position: 'absolute', bottom: -4, right: -4, minWidth: 28, height: 28, borderRadius: 14, backgroundColor: place === 1 ? c.tint : c.card, borderWidth: 2, borderColor: c.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                <Txt variant="footnote" color={place === 1 ? c.onTint : c.label} style={font('800')}>{it.rank}</Txt>
              </View>
            </View>
            <Txt variant="subhead" center numberOfLines={2} style={font('600')}>{mine ? t('board.you') : it.user.displayName}</Txt>
            {it.user.clan ? <Txt variant="caption" tone="label2" numberOfLines={1}>[{it.user.clan.tag}]</Txt> : null}
            <View style={{ alignSelf: 'stretch', height: tone.h, borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: tone.bg, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 10 }}>
              <Txt variant="headline" color={tone.fg} style={font('800')} numberOfLines={1}>{pts(it.points)}</Txt>
              {it.blocked ? <View style={{ marginTop: 6 }}><Badge text={t('board.blocked')} tone="gray" /></View> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function terrainBlock(c: ReturnType<typeof useTheme>['c'], tone: 'stone' | 'sand', h: number) {
  const x = terrain(c, tone);
  return { bg: x.soft, fg: x.text, h };
}

function BoardRow({ item, mine, last }: { item: LeaderboardItem; mine: boolean; last?: boolean }) {
  const { c } = useTheme();
  const { t, lang } = useI18n();
  const pts = usePoints();
  const sub = subtitleOf(item);
  return (
    <Cell
      title={mine ? `${item.user.displayName} (${t('board.you')})` : item.user.displayName}
      subtitle={sub || undefined}
      left={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Txt variant="headline" color={mine ? c.tint : c.label2} style={[{ width: 30, textAlign: 'right' }, font('700')]}>{item.rank}</Txt>
          <Avatar uri={photoUri(item.user.avatarUrl)} name={item.user.displayName} size={40} />
        </View>
      }
      right={item.blocked
        ? <Badge text={t('board.blocked')} tone="gray" />
        : <Txt variant="subhead" color={mine ? c.tint : c.label} style={font('700')}>{pts(item.points)}</Txt>}
      chevron={false}
      onPress={openable(item)}
      minHeight={60}
      accessibilityRole="link"
      accessibilityLabel={itemLabel(item, t, lang, mine)}
      last={last}
    />
  );
}
