import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Hero } from '../../components/Hero';
import {
  Avatar, Badge, Card, Cell, DifficultyBar, EmptyState, ErrorState, GlassView, IconButton, IconTile, LoadingState,
  NavScreen, PillButton, Section, Txt, useTheme,
} from '../../components/ui';
import { ActionSheet, type SheetAction } from '../../components/ActionSheet';
import { CarAndSeats } from '../../components/CarPicker';
import { carTitle, photoUri } from '../../components/Rows';
import SpotMap from '../../components/map/Map';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/apiClient';
import { useAuth } from '../../lib/auth';
import { useChat } from '../../lib/chat';
import { useI18n } from '../../lib/i18n';
import { errorMessage, eventErrorMessage } from '../../lib/errors';
import { confirmAsync } from '../../lib/dialogs';
import { sameId } from '../../lib/format';
import { pickPhoto } from '../../lib/photos';
import { successFeedback } from '../../lib/haptics';
import {
  badgeTone, canCancel, canLeave, canRemoveParticipants, cardBadge, eventLevel, eventLocation, formatEventWhen, withZoneLabel,
  joinState, placeName, placesLeft, splitParticipants, waitlistPosition,
} from '../../lib/eventLogic';
import type { CarSummary, EventDetail, EventParticipant, Id, Spot } from '../../lib/types';

const NO_SPOTS: Spot[] = [];

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, d } = useI18n();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const chat = useChat();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [people, setPeople] = useState<EventParticipant[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [joining, setJoining] = useState(false);
  const [cars, setCars] = useState<CarSummary[] | null>(null);
  const [carId, setCarId] = useState<Id | null>(null);
  const [seats, setSeats] = useState(0);
  const [menuFor, setMenuFor] = useState<EventParticipant | null>(null);

  /** only the newest load may fill the page (user switch, quick reloads) */
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const my = ++loadSeq.current;
    setLoadError(null);
    try {
      const [e, p] = await Promise.all([api.event(id), api.eventParticipants(id)]);
      if (my !== loadSeq.current) return;
      setEv(e);
      setPeople(p.items);
      setGone(false);
    } catch (e) {
      if (my !== loadSeq.current) return;
      if (e instanceof ApiError && e.status === 404) setGone(true);
      else setLoadError(e);
    }
  }, [id]);

  // A different account (or logged out) must not see the previous user's event state, cars or chat link.
  const userId = user?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const firstUser = useRef(true);
  useEffect(() => {
    if (firstUser.current) { firstUser.current = false; return; }
    loadSeq.current++;
    setEv(null);
    setPeople(null);
    setCars(null);
    setCarId(null);
    setSeats(0);
    setJoining(false);
    setNote(null);
    setMenuFor(null);
    load();
  }, [userId, load]);

  useFocusEffect(useCallback(() => { load(); }, [load, userId]));
  // someone joined / left / the organizer edited: reload live
  useEffect(() => chat.on('eventUpdated', (u) => { if (sameId(u.eventId, id)) load(); }), [chat, id, load]);

  async function openJoin() {
    if (!user) return router.push('/login');
    setJoining(true);
    setNote(null);
    if (!cars) {
      const forUser = user.id;
      try {
        const r = await api.cars(forUser);
        if (!sameId(forUser, userIdRef.current)) return;
        const items = [...r.items].sort((a, b) => (sameId(a.id, user.currentCarId) ? -1 : sameId(b.id, user.currentCarId) ? 1 : 0));
        setCars(items);
        if (items[0]) setCarId(items[0].id);
      } catch (e) {
        setNote({ text: errorMessage(e, t), error: true });
        setCars([]);
      }
    }
  }

  async function act(key: string, fn: () => Promise<unknown>, ok?: string | ((r: unknown) => string)) {
    setBusy(key);
    setNote(null);
    try {
      const r = await fn();
      if (ok) {
        successFeedback();
        setNote({ text: typeof ok === 'function' ? ok(r) : ok, error: false });
      }
      await load();
      chat.reload();
    } catch (e) {
      setNote({ text: eventErrorMessage(e, t, key === 'join' ? 'join' : 'other'), error: true });
      if (e instanceof ApiError && (e.status === 404 || e.status === 409 || e.status === 403)) await load();
    } finally {
      setBusy(null);
    }
  }

  const join = () => act(
    'join',
    async () => {
      const r = await api.joinEvent(id, carId!, seats);
      setJoining(false);
      return r;
    },
    (r) => ((r as EventDetail).myStatus === 'waitlist' ? t('events.waitlisted') : t('events.joined')),
  );
  const leave = async () => {
    if (!(await confirmAsync(t('events.leaveConfirm'), t('events.leave'), t('common.cancel')))) return;
    act('leave', () => api.leaveEvent(id), t('events.left'));
  };

  async function changeCover() {
    const r = await pickPhoto('car');
    if (!r.ok) {
      if (r.reason !== 'cancelled') setNote({ text: r.reason === 'denied' ? t('profile.photoDenied') : t('profile.photoFailed'), error: true });
      return;
    }
    act('cover', () => api.uploadEventCover(id, r.bytes));
  }

  const myId = user?.id;
  const split = useMemo(() => splitParticipants(people ?? []), [people]);

  if (gone) {
    return (
      <NavScreen fallback="/events">
        <EmptyState icon="events" title={t('events.gone')} actionLabel={t('events.title')} onAction={() => router.replace('/events')} />
      </NavScreen>
    );
  }
  if (!ev) {
    return loadError
      ? <NavScreen fallback="/events"><ErrorState message={errorMessage(loadError, t)} onRetry={load} /></NavScreen>
      : <LoadingState />;
  }

  const js = joinState(ev, !!user);
  const isOrg = ev.myStatus === 'organizer';
  const badge = cardBadge(ev);
  const loc = eventLocation(ev);
  const level = eventLevel(ev);
  const pos = waitlistPosition(people ?? [], myId);
  const when = withZoneLabel(formatEventWhen(ev.startsAt, ev.endsAt, { weekdays: d.events.weekdays, months: d.chat.months }), t('events.bakuTime'));
  const where = placeName(ev) ?? t('events.meetingPoint');

  function openMaps() {
    if (!loc) return;
    const { lat, lng } = loc;
    const url = Platform.select({
      ios: `http://maps.apple.com/?daddr=${lat},${lng}`,
      android: `geo:${lat},${lng}?q=${lat},${lng}`,
      default: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=13/${lat}/${lng}`,
    });
    Linking.openURL(url);
  }

  function personActions(p: EventParticipant): SheetAction[] {
    const out: SheetAction[] = [{ label: t('chat.openProfile'), onPress: () => router.push(`/user/${p.user.id}`) }];
    if (canRemoveParticipants(ev!) && !p.isOrganizer) {
      out.push({
        label: t('events.removeParticipant'),
        destructive: true,
        onPress: async () => {
          if (!(await confirmAsync(t('events.removeConfirm', { name: p.user.displayName }), t('common.remove'), t('common.cancel')))) return;
          act(`rm:${p.user.id}`, () => api.removeParticipant(id, p.user.id), t('events.removed', { name: p.user.displayName }));
        },
      });
    }
    return out;
  }

  const personCell = (p: EventParticipant, i: number) => {
    const isMe = sameId(p.user.id, myId);
    const car = p.car ? `${carTitle(p.car)} ${p.car.year}` : t('events.carRemoved');
    const extra = p.seats > 0 ? t('events.passengers', { count: p.seats }) : null;
    const queue = p.status === 'waitlist' ? t('events.queuePos', { n: i + 1 }) : null;
    const subtitle = [car, extra, queue].filter(Boolean).join(' · ');
    const tappable = isOrg && !isMe && canRemoveParticipants(ev);
    return (
      <Cell
        key={p.user.id}
        title={isMe ? `${p.user.displayName} (${t('chat.you')})` : p.user.displayName}
        subtitle={subtitle}
        left={<Avatar uri={photoUri(p.user.avatarUrl)} name={p.user.displayName} size={40} />}
        right={p.isOrganizer ? <Badge text={t('events.status.organizer')} /> : undefined}
        onPress={tappable ? () => setMenuFor(p) : () => router.push(`/user/${p.user.id}`)}
        accessibilityRole={tappable ? 'button' : 'link'}
        accessibilityLabel={[p.user.displayName, p.isOrganizer ? t('events.status.organizer') : null, subtitle].filter(Boolean).join(', ')}
      />
    );
  };

  let mainArea: React.ReactNode = null;
  if (js === 'closed') {
    mainArea = (
      <Card>
        <Txt variant="headline">{ev.status === 'cancelled' ? t('events.closedCancelled') : ev.status === 'finished' ? t('events.closedFinished') : t('events.closedStarted')}</Txt>
        {ev.status === 'cancelled' && ev.cancelReason ? <Txt variant="subhead" tone="label2" style={{ marginTop: 4 }}>{t('events.cancelReason', { reason: ev.cancelReason })}</Txt> : null}
      </Card>
    );
  } else if (js === 'login') {
    mainArea = <PillButton title={t('events.loginToJoin')} onPress={() => router.push('/login')} />;
  } else if (js === 'join' || js === 'joinWaitlist') {
    mainArea = joining ? (
      <View style={{ gap: 12 }}>
        {js === 'joinWaitlist' ? <Txt variant="subhead" tone="label2" center>{t('events.fullHint', { max: ev.maxCars })}</Txt> : null}
        <CarAndSeats cars={cars} carId={carId} onCar={setCarId} seats={seats} onSeats={setSeats} header={t('events.pickCar')} footer={t('events.pickCarHint')} />
        {cars?.length ? (
          <PillButton title={js === 'joinWaitlist' ? t('events.confirmWaitlist') : t('events.confirmJoin')} onPress={join} loading={busy === 'join'} disabled={!carId} />
        ) : null}
        <PillButton title={t('common.cancel')} variant="plain" onPress={() => setJoining(false)} />
      </View>
    ) : (
      <View style={{ gap: 8 }}>
        <PillButton
          title={js === 'joinWaitlist' ? t('events.joinWaitlist') : t('events.join')}
          icon="plus"
          variant={js === 'joinWaitlist' ? 'tinted' : 'filled'}
          onPress={openJoin}
        />
        <Txt variant="footnote" tone="label2" center>
          {js === 'joinWaitlist' ? t('events.fullHint', { max: ev.maxCars }) : t('events.placesLeft', { count: placesLeft(ev) })}
        </Txt>
      </View>
    );
  } else {
    // organizer / going / waitlist
    const status = js === 'organizer' ? t('events.youOrganize') : js === 'going' ? t('events.youGoing') : pos ? t('events.youWaitlist', { n: pos }) : t('events.youWaitlistNoPos');
    mainArea = (
      <View style={{ gap: 10 }}>
        <View style={{ alignItems: 'center' }}><Badge text={status} tone={js === 'waitlist' ? 'gray' : 'tint'} /></View>
        {ev.conversationId ? <PillButton title={t('events.openChat')} icon="chat" onPress={() => router.push(`/chat/${ev.conversationId}`)} /> : null}
        {canLeave(ev) ? (
          <PillButton title={js === 'waitlist' ? t('events.leaveWaitlist') : t('events.leave')} variant="gray" onPress={leave} loading={busy === 'leave'} />
        ) : null}
      </View>
    );
  }
  // read-only chat after cancel/finish stays reachable for participants
  if (js === 'closed' && ev.conversationId) {
    mainArea = (
      <View style={{ gap: 10 }}>
        {mainArea}
        <PillButton title={t('events.openChat')} icon="chat" variant="gray" onPress={() => router.push(`/chat/${ev.conversationId}`)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        <Hero
          kind="hills"
          height={220}
          fallback="/events"
          photoUri={photoUri(ev.coverUrl)}
          right={isOrg ? (
            ev.canEdit ? (
              <GlassView elevated style={{ height: 44, borderRadius: 22, flexDirection: 'row' }}>
                <IconButton icon="edit" label={t('events.edit')} onPress={() => router.push(`/event/edit/${ev.id}`)} style={{ backgroundColor: 'transparent', width: 48 }} />
                <IconButton icon="camera" label={ev.coverUrl ? t('events.coverChange') : t('events.coverAdd')} onPress={changeCover} style={{ backgroundColor: 'transparent', width: 48 }} />
              </GlassView>
            ) : null
          ) : (
            <IconButton
              icon="flag"
              glass
              label={t('events.report')}
              onPress={() => router.push(user ? { pathname: '/report', params: { targetType: 'event', targetId: String(ev.id) } } : '/login')}
            />
          )}
        />
        <View style={{ padding: 16, paddingTop: 20, gap: 20, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <View style={{ gap: 6, paddingHorizontal: 4 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {badge ? <Badge text={t(`events.status.${badge}`)} tone={badgeTone(badge)} /> : null}
              {ev.clan ? <Badge text={`[${ev.clan.tag}] ${ev.clan.name}`} tone={ev.visibility === 'clan' ? 'tint' : 'gray'} /> : null}
              <Badge text={ev.visibility === 'clan' ? t('events.clanOnly') : t('events.public')} tone="gray" />
            </View>
            <Txt variant="title1" accessibilityRole="header">{ev.title}</Txt>
            <Txt variant="subhead" tone="tint" accessibilityRole="link" onPress={() => router.push(`/user/${ev.organizer.id}`)}>
              {t('events.organizedBy', { name: ev.organizer.displayName })}
            </Txt>
          </View>

          <Section>
            <Cell title={t('events.when')} subtitle={when} left={<IconTile icon="events" />} />
            <Cell
              title={t('events.where')}
              subtitle={ev.spot || !ev.meetingPoint?.label ? where : `${t('events.meetingPoint')}: ${where}`}
              left={<IconTile icon={ev.spot ? 'pin' : 'location'} />}
              onPress={ev.spot ? () => router.push(`/spot/${ev.spot!.id}`) : undefined}
              accessibilityRole={ev.spot ? 'link' : undefined}
              accessibilityLabel={ev.spot ? `${t('events.where')}: ${where}. ${t('events.openSpot')}` : undefined}
            />
            <Cell
              title={t('events.carsOf', { count: ev.carCount, max: ev.maxCars })}
              subtitle={[t('events.people', { count: ev.participantCount }), ev.waitlistCount ? t('events.waiting', { count: ev.waitlistCount }) : null].filter(Boolean).join(' · ')}
              left={<IconTile icon="car" />}
            />
          </Section>

          {loc ? (
            <View style={{ gap: 8 }}>
              <View style={{ height: 170, borderRadius: 20, overflow: 'hidden' }} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <SpotMap spots={NO_SPOTS} picked={loc} center={loc} zoom={11} label={where} pinLabel={() => where} failedText={t('map.loadFailed')} />
              </View>
              <PillButton title={t('events.openInMaps')} icon="navigate" variant="gray" size="medium" onPress={openMaps} />
            </View>
          ) : null}

          {level ? (
            <Card>
              <DifficultyBar level={level} word={d.levels.names[level - 1]} label={t('events.minLevel')} caption={d.levels.explain[level - 1]} />
            </Card>
          ) : null}

          {ev.requirements.length ? (
            <View style={{ gap: 8 }}>
              <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 0.2 }} accessibilityRole="header">{t('events.requirements')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4 }} accessible accessibilityLabel={`${t('events.requirements')}: ${ev.requirements.join(', ')}`}>
                {ev.requirements.map((r) => <Badge key={r} text={r} />)}
              </View>
            </View>
          ) : null}

          {ev.description ? (
            <Section header={t('events.about')}>
              <View style={{ padding: 16 }}><Txt selectable>{ev.description}</Txt></View>
            </Section>
          ) : null}

          {mainArea}
          {note ? (
            <Txt variant="subhead" tone={note.error ? 'destructive' : 'label2'} center role={note.error ? 'alert' : undefined} accessibilityLiveRegion="polite">{note.text}</Txt>
          ) : null}

          <Section header={t('events.going', { count: split.going.length })}>
            {people === null ? <LoadingState inline /> : split.going.map((p, i) => personCell(p, i))}
          </Section>
          {split.waitlist.length ? (
            <Section header={t('events.waitlist', { count: split.waitlist.length })}>
              {split.waitlist.map((p, i) => personCell(p, i))}
            </Section>
          ) : null}

          {isOrg && (ev.canEdit || canCancel(ev)) ? (
            <Section header={t('events.organizerTools')}>
              {ev.canEdit ? <Cell title={t('events.edit')} left={<IconTile icon="edit" />} onPress={() => router.push(`/event/edit/${ev.id}`)} /> : null}
              {ev.canEdit ? (
                <Cell title={ev.coverUrl ? t('events.coverChange') : t('events.coverAdd')} left={<IconTile icon="camera" />} onPress={changeCover} disabled={busy === 'cover'} />
              ) : null}
              {ev.canEdit && ev.coverUrl ? (
                <Cell title={t('events.coverRemove')} left={<IconTile icon="trash" />} onPress={() => act('cover', () => api.deleteEventCover(id))} disabled={busy === 'cover'} />
              ) : null}
              {canCancel(ev) ? <Cell title={t('events.cancel')} destructive center chevron={false} onPress={() => router.push(`/event/cancel/${ev.id}`)} /> : null}
            </Section>
          ) : null}

          {user && !isOrg ? (
            <Section>
              <Cell
                title={t('events.report')}
                destructive
                center
                chevron={false}
                onPress={() => router.push({ pathname: '/report', params: { targetType: 'event', targetId: String(ev.id) } })}
              />
            </Section>
          ) : null}
        </View>
      </ScrollView>
      <ActionSheet
        visible={!!menuFor}
        title={menuFor ? t('events.participantActions', { name: menuFor.user.displayName }) : undefined}
        actions={menuFor ? personActions(menuFor) : []}
        onClose={() => setMenuFor(null)}
      />
    </View>
  );
}
