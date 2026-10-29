import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SpotMap from './map/Map';
import type { MapHandle } from './map/shared';
import { NavBar, NavScreen } from './ui/Screen';
import { PillButton, LinkButton } from './ui/Button';
import { SearchField, SegmentedControl, TextField } from './ui/Controls';
import { Cell, Section } from './ui/List';
import { EmptyState, ErrorState, FormError, LoadingState } from './ui/States';
import { Icon } from './ui/Icon';
import { Txt } from './ui/Text';
import { SpotCell } from './Rows';
import { DateTimeField } from './DateTimeField';
import { CarAndSeats } from './CarPicker';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/themeContext';
import { TAP } from '../lib/theme';
import { tapFeedback } from '../lib/haptics';
import { eventErrorMessage } from '../lib/errors';
import {
  addRequirement, EVENT_LIMITS, REQUIREMENT_SUGGESTIONS, toggleRequirement, validateEventForm, type EventFormState,
} from '../lib/eventLogic';
import type { CarSummary, Id, Spot } from '../lib/types';

const NO_SPOTS: Spot[] = [];

export interface EventFormProps {
  mode: 'create' | 'edit';
  initial: EventFormState;
  /** name of the initially chosen spot (edit, or "Create event here") */
  initialSpotName?: string | null;
  /** my clan (null = not in a clan → clan-only is disabled) */
  myClan: { name: string } | null;
  /** create only: my cars for "your car" */
  cars?: CarSummary[] | null;
  /** edit only: cars already going (max cars can't go below) */
  minCars?: number;
  onSubmit: (f: EventFormState, car: { carId: Id; seats: number } | null) => Promise<void>;
  onBack: () => void;
}

export function EventForm({ mode, initial, initialSpotName, myClan, cars, minCars, onSubmit, onBack }: EventFormProps) {
  const { t, d } = useI18n();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [f, setF] = useState<EventFormState>(initial);
  const [step, setStep] = useState<'form' | 'spot' | 'map'>('form');
  const [placeKind, setPlaceKind] = useState<'spot' | 'meeting'>(initial.spotId || !initial.meetingPoint ? 'spot' : 'meeting');
  const [spotName, setSpotName] = useState<string | null>(initialSpotName ?? null);
  const [hasEnd, setHasEnd] = useState(!!initial.endsAt);
  const [reqDraft, setReqDraft] = useState('');
  const [carId, setCarId] = useState<Id | null>(null);
  const [seats, setSeats] = useState(0);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof EventFormState>(k: K, v: EventFormState[K]) => setF((cur) => ({ ...cur, [k]: v }));

  // pick the first (current) car automatically
  useEffect(() => {
    if (mode === 'create' && cars?.length && !carId) setCarId(cars[0].id);
  }, [cars, carId, mode]);

  const now = new Date();
  const formState: EventFormState = {
    ...f,
    endsAt: hasEnd ? f.endsAt : null,
    spotId: placeKind === 'spot' ? f.spotId : null,
    meetingPoint: placeKind === 'meeting' ? f.meetingPoint : null,
  };
  const errors = validateEventForm(formState, now, { minCars });
  const err = (k: keyof typeof errors) => (touched && errors[k] ? t(`events.form.${errors[k]}`) : null);
  const carError = touched && mode === 'create' && !carId ? t('events.form.carRequired') : null;

  async function submit() {
    setTouched(true);
    setFormError(null);
    if (Object.keys(errors).length || (mode === 'create' && !carId)) {
      setFormError(t('errors.validation'));
      return;
    }
    setBusy(true);
    try {
      await onSubmit(formState, mode === 'create' ? { carId: carId!, seats } : null);
    } catch (e) {
      setFormError(eventErrorMessage(e, t, 'save'));
      setBusy(false);
    }
  }

  if (step === 'spot') {
    return (
      <SpotPicker
        onBack={() => setStep('form')}
        onPick={(s) => {
          set('spotId', s.id);
          setSpotName(s.name);
          if (!f.minDifficulty && s.type === 'trail' && s.difficulty) set('minDifficulty', s.difficulty);
          setStep('form');
        }}
      />
    );
  }
  if (step === 'map') {
    return (
      <MeetingPicker
        initial={f.meetingPoint}
        onBack={() => setStep('form')}
        onPick={(p) => {
          set('meetingPoint', { lat: p.lat, lng: p.lng, label: f.meetingPoint?.label ?? '' });
          setStep('form');
        }}
        insetsTop={insets.top}
        insetsBottom={insets.bottom}
      />
    );
  }

  const levelOptions: { v: number | null; label: string }[] = [
    { v: null, label: t('events.form.anyLevel') },
    ...[1, 2, 3, 4, 5].map((n) => ({ v: n, label: `${n} · ${d.levels.names[n - 1]}` })),
  ];
  const chips = [...REQUIREMENT_SUGGESTIONS, ...f.requirements.filter((r) => !REQUIREMENT_SUGGESTIONS.some((s) => s.toLowerCase() === r.toLowerCase()))];

  return (
    <NavScreen title={mode === 'create' ? t('events.form.createTitle') : t('events.form.editTitle')} fallback="/events">
      <TextField
        label={t('events.form.title')}
        placeholder={t('events.form.titlePlaceholder')}
        value={f.title}
        onChangeText={(v) => set('title', v)}
        maxLength={EVENT_LIMITS.titleMax}
        error={err('title')}
      />

      <DateTimeField
        label={t('events.form.starts')}
        value={f.startsAt}
        onChange={(v) => set('startsAt', v)}
        minimumDate={now}
        error={err('startsAt')}
      />
      {hasEnd ? (
        <View style={{ gap: 4 }}>
          <DateTimeField
            label={t('events.form.ends')}
            value={f.endsAt}
            onChange={(v) => set('endsAt', v)}
            minimumDate={f.startsAt ?? now}
            error={err('endsAt')}
          />
          <LinkButton title={t('events.form.removeEnd')} onPress={() => { setHasEnd(false); set('endsAt', null); }} style={{ alignSelf: 'flex-start', paddingHorizontal: 20 }} />
        </View>
      ) : (
        <LinkButton
          title={t('events.form.addEnd')}
          onPress={() => {
            setHasEnd(true);
            if (!f.endsAt && f.startsAt) set('endsAt', new Date(f.startsAt.getTime() + 8 * 60 * 60 * 1000));
          }}
          style={{ alignSelf: 'flex-start', paddingHorizontal: 20 }}
        />
      )}

      <View style={{ gap: 10 }}>
        <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 0.2 }}>{t('events.form.place')}</Txt>
        <SegmentedControl
          label={t('events.form.placeType')}
          value={placeKind}
          onChange={setPlaceKind}
          options={[{ value: 'spot', label: t('events.form.spot') }, { value: 'meeting', label: t('events.form.meeting') }]}
          style={{ alignSelf: 'stretch' }}
        />
        {placeKind === 'spot' ? (
          <Section>
            <Cell
              title={f.spotId ? (spotName ?? t('events.form.pickSpot')) : t('events.form.pickSpot')}
              left={<Icon name="pin" size={22} color={c.tint} />}
              value={f.spotId ? t('events.form.changeSpot') : undefined}
              action={!f.spotId}
              onPress={() => setStep('spot')}
              accessibilityLabel={f.spotId ? `${spotName ?? ''}, ${t('events.form.changeSpot')}` : t('events.form.pickSpot')}
            />
          </Section>
        ) : (
          <>
            <Section>
              <Cell
                title={f.meetingPoint
                  ? t('events.form.meetingAt', { lat: f.meetingPoint.lat.toFixed(4), lng: f.meetingPoint.lng.toFixed(4) })
                  : t('events.form.setMeeting')}
                left={<Icon name="location" size={22} color={c.tint} />}
                value={f.meetingPoint ? t('events.form.changeMeeting') : undefined}
                action={!f.meetingPoint}
                onPress={() => setStep('map')}
              />
            </Section>
            <TextField
              label={t('events.form.meetingLabel')}
              placeholder={t('events.form.meetingLabelPlaceholder')}
              value={f.meetingPoint?.label ?? ''}
              onChangeText={(v) => f.meetingPoint && set('meetingPoint', { ...f.meetingPoint, label: v })}
              editable={!!f.meetingPoint}
              maxLength={EVENT_LIMITS.labelMax}
              error={err('label')}
            />
          </>
        )}
        {err('place') ? <Txt variant="footnote" tone="destructive" style={{ paddingHorizontal: 20 }} role="alert">{err('place')}</Txt> : null}
      </View>

      <TextField
        label={t('events.form.maxCars')}
        hint={t('events.form.maxCarsHint')}
        value={f.maxCars}
        onChangeText={(v) => set('maxCars', v.replace(/[^0-9]/g, '').slice(0, 3))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={3}
        error={err('maxCars')}
      />

      <View style={{ gap: 8 }}>
        <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 0.2 }}>{t('events.form.minLevel')}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4 }} accessibilityRole="radiogroup" accessibilityLabel={t('events.form.minLevel')}>
          {levelOptions.map((o) => (
            <Chip key={String(o.v)} label={o.label} on={f.minDifficulty === o.v} radio onPress={() => set('minDifficulty', o.v)} />
          ))}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <TextField
          label={t('events.form.requirements')}
          hint={t('events.form.requirementsHint')}
          placeholder={t('events.form.requirementPlaceholder')}
          value={reqDraft}
          onChangeText={setReqDraft}
          onSubmitEditing={() => { set('requirements', addRequirement(f.requirements, reqDraft)); setReqDraft(''); }}
          maxLength={EVENT_LIMITS.requirementMax}
          editable={f.requirements.length < EVENT_LIMITS.requirementsMax}
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('events.form.addRequirement')}
              onPress={() => { set('requirements', addRequirement(f.requirements, reqDraft)); setReqDraft(''); }}
              style={{ width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center', marginRight: -10 }}
            >
              <Icon name="plus" size={22} color={c.tint} strokeWidth={2.6} />
            </Pressable>
          }
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4 }}>
          {chips.map((tag) => {
            const on = f.requirements.some((r) => r.toLowerCase() === tag.toLowerCase());
            const full = !on && f.requirements.length >= EVENT_LIMITS.requirementsMax;
            return <Chip key={tag} label={tag} on={on} disabled={full} onPress={() => set('requirements', toggleRequirement(f.requirements, tag))} />;
          })}
        </View>
      </View>

      <TextField
        label={`${t('events.form.description')} (${t('common.optional')})`}
        placeholder={t('events.form.descriptionPlaceholder')}
        value={f.description}
        onChangeText={(v) => set('description', v)}
        multiline
        maxLength={EVENT_LIMITS.descriptionMax}
        error={err('description')}
      />

      <View style={{ gap: 6 }}>
        <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 0.2 }}>{t('events.form.visibility')}</Txt>
        <SegmentedControl
          label={t('events.form.visibility')}
          value={f.visibility}
          onChange={(v) => { if (v === 'public' || myClan) set('visibility', v); }}
          options={[{ value: 'public', label: t('events.form.public') }, { value: 'clan', label: t('events.form.clan') }]}
          style={{ alignSelf: 'stretch' }}
        />
        <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20 }}>
          {!myClan ? t('events.form.needClan') : f.visibility === 'clan' ? `${t('events.form.clanHint')} (${myClan.name})` : ' '}
        </Txt>
      </View>

      {mode === 'create' ? (
        <CarAndSeats
          cars={cars}
          carId={carId}
          onCar={setCarId}
          seats={seats}
          onSeats={setSeats}
          header={t('events.form.yourCar')}
          footer={t('events.form.yourCarHint')}
          error={carError}
        />
      ) : null}

      <FormError message={formError} />
      <PillButton
        title={mode === 'create' ? t('events.form.submitCreate') : t('events.form.submitSave')}
        onPress={submit}
        loading={busy}
        disabled={mode === 'create' && cars?.length === 0}
      />
    </NavScreen>
  );
}

function Chip({ label, on, onPress, disabled, radio }: { label: string; on: boolean; onPress: () => void; disabled?: boolean; radio?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole={radio ? 'radio' : 'checkbox'}
      accessibilityState={radio ? { checked: on, disabled: !!disabled } : { checked: on, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => { tapFeedback(); onPress(); }}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TAP, paddingHorizontal: 14, borderRadius: TAP / 2, backgroundColor: on ? c.tint : c.card },
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.75 },
      ]}
    >
      {on && !radio ? <Icon name="check" size={14} color={c.onTint} strokeWidth={2.8} /> : null}
      <Txt variant="subhead" color={on ? c.onTint : c.label} style={{ fontWeight: '600' }}>{label}</Txt>
    </Pressable>
  );
}

/** Step: choose one of the shared spots (search by name). */
function SpotPicker({ onBack, onPick }: { onBack: () => void; onPick: (s: Spot) => void }) {
  const { t } = useI18n();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Spot[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  const load = useCallback(async (query: string) => {
    const id = ++seq.current;
    setError(null);
    try {
      const r = await api.spots({ q: query.trim() || undefined });
      if (id === seq.current) setItems(r.items);
    } catch (e) {
      if (id === seq.current) setError(e);
    }
  }, []);
  useEffect(() => {
    const h = setTimeout(() => load(q), q ? 300 : 0);
    return () => clearTimeout(h);
  }, [q, load]);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <BackOverride onBack={onBack} />
      <View style={{ paddingTop: insets.top }}>
        <NavBar title={t('events.form.pickSpot')} onBack={onBack} />
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ width: '100%', maxWidth: 640, alignSelf: 'center', padding: 16, paddingBottom: 32 + insets.bottom, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <SearchField value={q} onChangeText={setQ} placeholder={t('events.form.searchSpots')} label={t('events.form.searchSpots')} />
        {error ? <ErrorState message={eventErrorMessage(error, t)} onRetry={() => load(q)} /> : items === null ? <LoadingState inline /> : items.length ? (
          <Section>
            {items.slice(0, 100).map((s) => <SpotCell key={s.id} spot={s} onPress={() => onPick(s)} />)}
          </Section>
        ) : <EmptyState icon="search" title={t('events.form.noSpots')} />}
      </ScrollView>
    </View>
  );
}

/** Android hardware back inside a form step returns to the form instead of leaving the page. */
function BackOverride({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);
  return null;
}

/** Step: move the map so its centre is the meeting point (or tap the map). */
function MeetingPicker({ initial, onBack, onPick, insetsTop, insetsBottom }: {
  initial: { lat: number; lng: number } | null; onBack: () => void; onPick: (p: { lat: number; lng: number }) => void;
  insetsTop: number; insetsBottom: number;
}) {
  const { t } = useI18n();
  const { c } = useTheme();
  const mapRef = useRef<MapHandle>(null);
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(initial);
  const onMapPress = useCallback((lat: number, lng: number) => setPicked({ lat, lng }), []);
  const pinLabel = useCallback(() => '', []);
  const center = useMemo(() => initial ?? undefined, [initial]);
  const useCenter = async () => {
    const p = await mapRef.current?.getCenter();
    if (p) setPicked(p);
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <BackOverride onBack={onBack} />
      <View style={{ paddingTop: insetsTop }}>
        <NavBar title={t('events.form.meeting')} onBack={onBack} />
        <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20, paddingBottom: 12 }}>{t('events.form.pickOnMap')}</Txt>
      </View>
      <View style={{ flex: 1 }}>
        <SpotMap
          ref={mapRef}
          spots={NO_SPOTS}
          picked={picked}
          center={center}
          zoom={initial ? 12 : undefined}
          onMapPress={onMapPress}
          label={t('events.form.meeting')}
          pinLabel={pinLabel}
          failedText={t('map.loadFailed')}
        />
      </View>
      <View style={{ padding: 16, paddingBottom: 16 + insetsBottom, gap: 10, backgroundColor: c.bg }}>
        <Txt variant="footnote" tone="label2" accessibilityLiveRegion="polite" center>
          {picked ? t('events.form.meetingAt', { lat: picked.lat.toFixed(4), lng: picked.lng.toFixed(4) }) : ' '}
        </Txt>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <PillButton title={t('events.form.useCenter')} icon="pin" variant="gray" style={{ flex: 1 }} onPress={useCenter} />
          <PillButton title={t('events.form.done')} disabled={!picked} style={{ flex: 1 }} onPress={() => picked && onPick(picked)} />
        </View>
      </View>
    </View>
  );
}
