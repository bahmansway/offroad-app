import React from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../lib/themeContext';
import { useI18n } from '../lib/i18n';
import { radius, TAP } from '../lib/theme';
import { bakuParts, bakuTime, badgeTone, cardBadge, dateBlock, eventLevel, formatEventWhen, placeName, withZoneLabel } from '../lib/eventLogic';
import type { EventSummary } from '../lib/types';
import { Badge } from './ui/Controls';
import { Icon } from './ui/Icon';
import { Txt } from './ui/Text';

/** Date tile: "NOV" over "02". */
export function DateBlock({ iso, size = 56, muted }: { iso: string; size?: number; muted?: boolean }) {
  const { c } = useTheme();
  const { d } = useI18n();
  const b = dateBlock(iso, d.events.monthsShort);
  return (
    <View
      style={{ width: size, height: size + 4, borderRadius: radius.tile, backgroundColor: muted ? c.fill : c.tintSoft, alignItems: 'center', justifyContent: 'center' }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Txt variant="caption" color={muted ? c.label2 : c.tintSoftText} style={{ fontWeight: '700', letterSpacing: 0.6 }}>{b.month}</Txt>
      <Txt variant="title2" color={muted ? c.label2 : c.tintSoftText} style={{ lineHeight: 26 }}>{b.day}</Txt>
    </View>
  );
}

/** Text parts of a card, shared by the card and its screen-reader label. */
export function useEventCardText(e: EventSummary) {
  const { t, d } = useI18n();
  const level = eventLevel(e);
  const badge = cardBadge(e);
  const when = `${d.events.weekdays[bakuParts(new Date(e.startsAt)).weekday] ?? ''} ${bakuTime(e.startsAt)}`;
  /** full date for screen readers, in the app language */
  const whenFull = withZoneLabel(formatEventWhen(e.startsAt, e.endsAt, { weekdays: d.events.weekdays, months: d.chat.months }), t('events.bakuTime'));
  return {
    when,
    whenFull,
    place: placeName(e) ?? t('events.meetingPoint'),
    cars: t('events.carsOf', { count: e.carCount, max: e.maxCars }),
    level: level ? `${level} · ${d.levels.names[level - 1]}` : null,
    clan: e.clan ? `[${e.clan.tag}]` : null,
    clanOnly: e.visibility === 'clan',
    badge,
    badgeText: badge ? t(`events.status.${badge}`) : null,
    waiting: e.waitlistCount > 0 ? t('events.waiting', { count: e.waitlistCount }) : null,
  };
}

/** List card for an event (Tədbirlər tab, spot page, clan page). */
export function EventCard({ event: e, onPress }: { event: EventSummary; onPress?: () => void }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const x = useEventCardText(e);
  const over = e.status !== 'scheduled';
  const label = [
    e.title, x.whenFull, x.place, x.cars, x.waiting,
    x.level ? `${t('spot.difficulty')} ${x.level}` : null,
    x.clan ? `${t('clan.clanHeader')} ${e.clan!.name}${x.clanOnly ? `, ${t('events.clanOnly')}` : ''}` : null,
    x.badgeText,
  ].filter(Boolean).join(', ');
  return (
    <Pressable
      onPress={onPress ?? (() => router.push(`/event/${e.id}`))}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => [
        { flexDirection: 'row', gap: 14, padding: 14, borderRadius: radius.card - 6, backgroundColor: c.card, minHeight: TAP },
        pressed && { opacity: 0.85 },
      ]}
    >
      <DateBlock iso={e.startsAt} muted={over} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Txt variant="headline" numberOfLines={2} style={over ? { color: c.label2 } : undefined}>{e.title}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name={e.spot ? 'pin' : 'location'} size={14} color={c.label2} />
          <Txt variant="subhead" tone="label2" numberOfLines={1} style={{ flexShrink: 1 }}>{`${x.when} · ${x.place}`}</Txt>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          <Badge text={x.cars} tone="gray" />
          {x.level ? <Badge text={x.level} /> : null}
          {x.clan ? <Badge text={x.clanOnly ? `${x.clan} · ${t('events.clanOnly')}` : x.clan} tone={x.clanOnly ? 'tint' : 'gray'} /> : null}
          {x.badge ? <Badge text={x.badgeText!} tone={badgeTone(x.badge)} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

/** A small stack of event cards (spot / clan pages). */
export function EventList({ items }: { items: EventSummary[] }) {
  return <View style={{ gap: 10 }}>{items.map((e) => <EventCard key={e.id} event={e} />)}</View>;
}
