import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../lib/themeContext';
import { useI18n } from '../lib/i18n';
import { radius, TAP, type TerrainTone } from '../lib/theme';
import {
  bakuParts, bakuTime, cardBadge, dateBlock, eventLevel, formatEventWhen, isSoon, placeName, withZoneLabel, type CardBadge,
} from '../lib/eventLogic';
import type { EventSummary } from '../lib/types';
import { Badge, DateBlock as CalendarBlock, DifficultySign, SeatBar, type BadgeTone } from './ui/Controls';
import { Icon } from './ui/Icon';
import { Txt } from './ui/Text';

/** Calendar date block for an event (Baku date). Tint month strip when it starts within 7 days. */
export function EventDate({ iso, muted, style }: { iso: string; muted?: boolean; style?: StyleProp<ViewStyle> }) {
  const { d } = useI18n();
  const b = dateBlock(iso, d.events.monthsShort);
  const when = new Date(iso);
  const weekday = Number.isNaN(when.getTime()) ? undefined : d.events.weekdaysLong[bakuParts(when).weekday];
  return <CalendarBlock month={b.month} day={b.day} weekday={weekday} soon={!muted && isSoon(iso)} muted={muted} style={style} />;
}

/** Old name, kept for imports: `<DateBlock iso … />`. */
export function DateBlock({ iso, muted }: { iso: string; size?: number; muted?: boolean }) {
  return <EventDate iso={iso} muted={muted} />;
}

/** Tone for an event status chip: forest = open/going, sand = waitlist, stone/gray = over. */
export function statusTone(b: CardBadge): BadgeTone {
  switch (b) {
    case 'going': case 'organizer': return 'forest';
    case 'waitlist': return 'sand';
    case 'full': return 'stone';
    default: return 'gray';
  }
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
    time: bakuTime(e.startsAt),
    whenFull,
    place: placeName(e) ?? t('events.meetingPoint'),
    cars: t('events.carsOf', { count: e.carCount, max: e.maxCars }),
    levelNum: level,
    level: level ? `${level} · ${d.levels.names[level - 1]}` : null,
    /** clan name, not the raw tag */
    clan: e.clan ? e.clan.name : null,
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
    x.clan ? `${t('clan.clanHeader')} ${x.clan}${x.clanOnly ? `, ${t('events.clanOnly')}` : ''}` : null,
    x.badgeText,
  ].filter(Boolean).join(', ');
  const clanTone: TerrainTone = 'stone';
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
      <EventDate iso={e.startsAt} muted={over} />
      <View style={{ flex: 1, minWidth: 0, gap: 6 }} importantForAccessibility="no-hide-descendants">
        <Txt variant="headline" numberOfLines={2} style={over ? { color: c.label2 } : undefined}>{e.title}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name={e.spot ? 'pin' : 'location'} size={14} color={c.label2} />
          <Txt variant="subhead" tone="label2" numberOfLines={1} style={{ flexShrink: 1 }}>{`${x.time} · ${x.place}`}</Txt>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          {x.levelNum ? <DifficultySign level={x.levelNum} short /> : null}
          {x.clan ? <Badge text={x.clanOnly ? `${x.clan} · ${t('events.clanOnly')}` : x.clan} tone={clanTone} /> : null}
          {x.badge ? <Badge text={x.badgeText!} tone={statusTone(x.badge)} /> : null}
          {x.waiting && !x.badge ? <Badge text={x.waiting} tone="sand" /> : null}
        </View>
        {over ? null : <SeatBar count={e.carCount} max={e.maxCars} text={x.cars} />}
      </View>
    </Pressable>
  );
}

/** A small stack of event cards (spot / clan pages). */
export function EventList({ items }: { items: EventSummary[] }) {
  return <View style={{ gap: 10 }}>{items.map((e) => <EventCard key={e.id} event={e} />)}</View>;
}
