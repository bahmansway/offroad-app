import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Hero } from '../../components/Hero';
import {
  Avatar, Badge, Card, Cell, DifficultySign, EmptyState, ErrorState, GlassView, IconButton, IconTile, LoadingState,
  NavScreen, PillButton, Section, Txt, useTheme,
} from '../../components/ui';
import { ActionSheet, MoreMenu, type SheetAction } from '../../components/ActionSheet';
import { EventDate, statusTone } from '../../components/EventCard';
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
  canCancel, canLeave, canRemoveParticipants, cardBadge, eventLevel, eventLocation, formatEventWhen, withZoneLabel,
  joinState, placeName, placesLeft, splitParticipants, waitlistPosition,
} from '../../lib/eventLogic';
import type { CarSummary, EventDetail, EventParticipant, Id, Spot } from '../../lib/types';
import { useNotifications } from '../../lib/notifications';
import { addToCalendar, calendarMode, removeFromCalendar, storedCalendarEntry } from '../../lib/calendar';
import { calendarAction, type StoredCalendarEntry } from '../../lib/calendarLogic';
import { API_URL } from '../../lib/config';

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
  const notifications = useNotifications();
  const [calEntry, setCalEntry] = useState<StoredCalendarEntry | null>(null);
  const [calNote, setCalNote] = useState<{ text: string; error: boolean } | null>(null);

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
      // keep this event's reminders right (joined, left, time changed, cancelled)
      notifications.syncEventReminders(e);
    } catch (e) {
      if (my !== loadSeq.current) return;
      if (e instanceof ApiError && e.status === 404) setGone(true);
      else setLoadError(e);
    }
  }, [id, notifications.syncEventReminders]);

  // the phone calendar entry is remembered per account (another user on this phone starts fresh)
  const calUser = user?.id ?? null;
  useEffect(() => {
    let alive = true;
    setCalEntry(null);
    setCalNote(null);
    storedCalendarEntry(calUser, String(id)).then((v) => { if (alive) setCalEntry(v); });
    return () => { alive = false; };
  }, [id, calUser]);

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
    if (!(await confirmAsync(t('events.leaveConfirm'), t('events.leave'), t('common.cancel'), { destructive: true }))) return;
    act('leave', () => api.leaveEvent(id), t('events.left'));
  };

  async function calendar() {
    if (!ev) return;
    const forUser = calUser;
    setBusy('calendar');
    setCalNote(null);
    const removing = ev.status === 'cancelled';
    if (removing && !(await confirmAsync(t('calendar.removeConfirm'), t('calendar.remove'), t('common.cancel'), { destructive: true }))) {
      setBusy(null);
      return;
    }
    const r = removing
      ? await removeFromCalendar(forUser, String(ev.id))
      : await addToCalendar(forUser, ev, { appUrl: API_URL, meetingPointWord: t('events.meetingPoint') });
    setBusy(null);
    if (forUser !== userIdRef.current) return; // logged out / switched meanwhile
    if (r.ok) {
      successFeedback();
      const key = { downloaded: 'calendar.downloaded', updated: 'calendar.updated', added: 'calendar.added', removed: 'calendar.removed' }[r.action];
      setCalNote({ text: t(key), error: false });
      setCalEntry(await storedCalendarEntry(forUser, String(ev.id)));
    } else {
      setCalNote({ text: t(`calendar.${r.reason}`), error: true });
    }
  }

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
          if (!(await confirmAsync(t('events.removeConfirm', { name: p.user.displayName }), t('common.remove'), t('common.cancel'), { destructive: true }))) return;
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

  // "Add to calendar": phone calendar (remembers the entry, offers an update when time / place changed) or .ics on the web
  const calAction = calendarAction(calEntry, ev, { mode: calendarMode });
  const calendarArea = calAction ? (
    <View style={{ gap: 6 }}>
      <PillButton
        title={t({ add: 'calendar.add', update: 'calendar.update', added: 'calendar.inCalendar', remove: 'calendar.remove' }[calAction])}
        icon={calAction === 'added' ? 'check' : calAction === 'remove' ? 'trash' : 'calendarSmall'}
        variant={calAction === 'update' ? 'tinted' : 'gray'}
        size="medium"
        onPress={calendar}
        loading={busy === 'calendar'}
        disabled={calAction === 'added'}
      />
      {!calNote && calAction === 'update' ? <Txt variant="footnote" tone="label2" center>{t('calendar.changedHint')}</Txt> : null}
      {!calNote && calAction === 'remove' ? <Txt variant="footnote" tone="label2" center>{t('calendar.cancelledHint')}</Txt> : null}
      {calNote ? (
        <Txt variant="footnote" tone={calNote.error ? 'destructive' : 'label2'} center role={calNote.error ? 'alert' : undefined} accessibilityLiveRegion="polite">{calNote.text}</Txt>
      ) : null}
    </View>
  ) : null;

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
    // organizer / going are shown once, as a chip under the hero; only the waitlist place is extra here
    const status = js === 'waitlist' ? (pos ? t('events.youWaitlist', { n: pos }) : t('events.youWaitlistNoPos')) : null;
    mainArea = (
      <View style={{ gap: 10 }}>
        {status ? <View style={{ alignItems: 'center' }}><Badge text={status} tone="sand" /></View> : null}
        {canLeave(ev) ? (
          <PillButton title={js === 'waitlist' ? t('events.leaveWaitlist') : t('events.leave')} variant="gray" onPress={leave} loading={busy === 'leave'} />
        ) : null}
      </View>
    );
  }
  // the event chat (also read-only after cancel/finish) is the chat icon in the hero

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        <Hero
          kind="hills"
          height={220}
          fallback="/events"
          photoUri={photoUri(ev.coverUrl)}
          bottomLeft={<EventDate iso={ev.startsAt} muted={ev.status !== 'scheduled'} />}
          right={
            <>
              {ev.conversationId ? <IconButton icon="chat" glass label={t('events.openChat')} onPress={() => router.push(`/chat/${ev.conversationId}`)} /> : null}
              {isOrg && ev.canEdit ? (
                <GlassView elevated style={{ height: 44, borderRadius: 22, flexDirection: 'row' }}>
                  <IconButton icon="edit" label={t('events.edit')} onPress={() => router.push(`/event/edit/${ev.id}`)} style={{ backgroundColor: 'transparent', width: 48 }} />
                  <IconButton icon="camera" label={ev.coverUrl ? t('events.coverChange') : t('events.coverAdd')} onPress={changeCover} style={{ backgroundColor: 'transparent', width: 48 }} />
                </GlassView>
              ) : null}
              {isOrg ? null : (
                <MoreMenu
                  title={ev.title}
                  actions={[{ label: t('events.report'), destructive: true, onPress: () => router.push(user ? { pathname: '/report', params: { targetType: 'event', targetId: String(ev.id) } } : '/login') }]}
                />
              )}
            </>
          }
        />
        <View style={{ padding: 16, paddingTop: 20, gap: 20, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <View style={{ gap: 6, paddingHorizontal: 4 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {badge === 'organizer' ? <Badge text={t('events.youOrganize')} tone="gray" />
                : badge ? <Badge text={t(`events.status.${badge}`)} tone={statusTone(badge)} /> : null}
              {ev.clan ? <Badge text={ev.visibility === 'clan' ? `${ev.clan.name} · ${t('events.clanOnly')}` : ev.clan.name} tone="stone" icon="people" />
                : ev.visibility === 'clan' ? <Badge text={t('events.clanOnly')} tone="stone" /> : null}
            </View>
            <Txt variant="title1" accessibilityRole="header">{ev.title}</Txt>
            {isOrg ? null : (
              <Txt variant="subhead" tone="tint" accessibilityRole="link" onPress={() => router.push(`/user/${ev.organizer.id}`)}>
                {t('events.organizedBy', { name: ev.organizer.displayName })}
              </Txt>
            )}
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
            {level ? (
              <Cell
                title={t('events.minLevel')}
                subtitle={`${t('events.atLeast', { level: `${level} · ${d.levels.names[level - 1]}` })} — ${d.levels.explain[level - 1]}`}
                left={<IconTile icon="car" />}
                right={<DifficultySign level={level} variant="number" />}
              />
            ) : null}
            <Cell
              title={t('events.carsOf', { count: ev.carCount, max: ev.maxCars })}
              subtitle={[t('events.people', { count: ev.participantCount }), ev.waitlistCount ? t('events.waiting', { count: ev.waitlistCount }) : null].filter(Boolean).join(' · ')}
              left={<IconTile icon="people" />}
            />
          </Section>

          {calendarArea}

          {loc ? (
            <View style={{ gap: 8 }}>
              <View style={{ height: 170, borderRadius: 20, overflow: 'hidden' }} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <SpotMap spots={NO_SPOTS} picked={loc} center={loc} zoom={11} label={where} pinLabel={() => where} errorCompact />
              </View>
              <PillButton title={t('events.openInMaps')} icon="navigate" variant="gray" size="medium" onPress={openMaps} />
            </View>
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
