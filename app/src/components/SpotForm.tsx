import React, { useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SpotMap from './map/Map';
import type { MapHandle } from './map/shared';
import { NavScreen, NavBar, goBack } from './ui/Screen';
import { PillButton } from './ui/Button';
import { DifficultyBar, SegmentedControl, TextField } from './ui/Controls';
import { Cell, Section } from './ui/List';
import { FormError } from './ui/States';
import { Icon } from './ui/Icon';
import { Txt } from './ui/Text';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/themeContext';
import { errorMessage } from '../lib/errors';
import { between, normalizeTag } from '../lib/validation';
import type { Spot, SpotInput, SpotType } from '../lib/types';

const NO_SPOTS: Spot[] = [];
const MAX_TAGS = 8;

export function SpotForm({ initial, title, submitLabel, onSubmit }: {
  initial?: Spot;
  title: string;
  submitLabel: string;
  onSubmit: (input: SpotInput) => Promise<void>;
}) {
  const { t, d } = useI18n();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'pick' | 'form'>(initial ? 'form' : 'pick');
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(initial ? { lat: initial.lat, lng: initial.lng } : null);
  const [type, setType] = useState<SpotType>(initial?.type ?? 'trail');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [level, setLevel] = useState<number | null>(initial?.difficulty ?? null);
  const [season, setSeason] = useState(initial?.season ?? '');
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const mapRef = useRef<MapHandle>(null);
  const useCenter = async () => {
    const c = await mapRef.current?.getCenter();
    if (c) setPicked(c);
  };
  const onMapPress = useCallback((lat: number, lng: number) => setPicked({ lat, lng }), []);
  const pinLabel = useCallback(() => '', []);

  const errors = {
    name: between(name, 2, 80) ? null : t('addSpot.nameInvalid'),
    description: description.length <= 2000 ? null : t('addSpot.descriptionTooLong'),
    level: type === 'trail' && !level ? t('addSpot.levelRequired') : null,
    season: season.trim().length <= 40 ? null : t('addSpot.seasonTooLong'),
  };
  const err = (k: keyof typeof errors) => (touched ? errors[k] : null);

  function addTag() {
    const tag = normalizeTag(tagDraft);
    if (!tag || tags.length >= MAX_TAGS || tags.some((x) => x.toLowerCase() === tag.toLowerCase())) {
      setTagDraft('');
      return;
    }
    setTags([...tags, tag]);
    setTagDraft('');
  }

  async function submit() {
    setTouched(true);
    setFormError(null);
    if (!picked) {
      setFormError(t('addSpot.pinRequired'));
      return;
    }
    if (Object.values(errors).some(Boolean)) return;
    setBusy(true);
    try {
      await onSubmit({
        type,
        name: name.trim(),
        description: description.trim(),
        lat: Math.round(picked.lat * 1e6) / 1e6,
        lng: Math.round(picked.lng * 1e6) / 1e6,
        difficulty: type === 'trail' ? level : null,
        season: season.trim() || null,
        tags,
      });
    } catch (e) {
      setFormError(errorMessage(e, t, initial ? 'default' : 'create'));
      setBusy(false);
    }
  }

  if (step === 'pick') {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={{ paddingTop: insets.top }}>
          <NavBar title={title} onBack={() => goBack('/')} />
          <View style={{ paddingHorizontal: 20, paddingBottom: 12, gap: 4 }}>
            <Txt variant="headline">{t('addSpot.pickTitle')}</Txt>
            <Txt variant="footnote" tone="label2">{t('addSpot.pickHint')}</Txt>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <SpotMap
            ref={mapRef}
            spots={NO_SPOTS}
            picked={picked}
            center={picked ?? undefined}
            onMapPress={onMapPress}
            label={t('addSpot.pickTitle')}
            pinLabel={pinLabel}
            failedText={t('map.loadFailed')}
          />
        </View>
        <View style={{ padding: 16, paddingBottom: 16 + insets.bottom, gap: 10, backgroundColor: c.bg }}>
          <Txt variant="footnote" tone="label2" accessibilityLiveRegion="polite" center>
            {picked ? t('addSpot.pinPlaced', { lat: picked.lat.toFixed(4), lng: picked.lng.toFixed(4) }) : ' '}
          </Txt>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <PillButton title={t('addSpot.useCenter')} icon="pin" variant="gray" style={{ flex: 1 }} onPress={useCenter} />
            <PillButton title={t('addSpot.next')} disabled={!picked} style={{ flex: 1 }} onPress={() => setStep('form')} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <NavScreen title={title}>
      <Section>
        <Cell
          title={picked ? `${picked.lat.toFixed(4)}, ${picked.lng.toFixed(4)}` : '—'}
          left={<Icon name="pin" size={22} color={c.tint} />}
          value={t('addSpot.changeLocation')}
          onPress={() => setStep('pick')}
          accessibilityLabel={t('addSpot.changeLocation')}
        />
      </Section>

      <SegmentedControl
        label={t('addSpot.type')}
        value={type}
        onChange={setType}
        options={[{ value: 'trail', label: t('spot.trail') }, { value: 'camp', label: t('spot.camp') }]}
        style={{ alignSelf: 'stretch' }}
      />
      <TextField label={t('addSpot.name')} placeholder={t('addSpot.namePlaceholder')} value={name} onChangeText={setName} maxLength={80} error={err('name')} />
      <TextField
        label={t('addSpot.description')}
        placeholder={t('addSpot.descriptionPlaceholder')}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={2000}
        error={err('description')}
      />

      {type === 'trail' ? (
        <View style={{ gap: 6 }}>
          <Section header={t('addSpot.level')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Cell
                key={n}
                title={`${n} · ${d.levels.names[n - 1]}`}
                subtitle={d.levels.explain[n - 1]}
                checked={level === n}
                accessibilityRole="radio"
                accessibilityLabel={`${n} — ${d.levels.names[n - 1]}: ${d.levels.explain[n - 1]}`}
                onPress={() => setLevel(n)}
              />
            ))}
          </Section>
          {level ? <View style={{ paddingHorizontal: 20 }}><DifficultyBar level={level} label={t('spot.difficulty')} compact /></View> : null}
          {err('level') ? <Txt variant="footnote" tone="destructive" style={{ paddingHorizontal: 20 }} role="alert">{err('level')}</Txt> : null}
        </View>
      ) : null}

      <TextField label={`${t('addSpot.season')} (${t('common.optional')})`} placeholder={t('addSpot.seasonPlaceholder')} value={season} onChangeText={setSeason} maxLength={40} error={err('season')} />

      <View style={{ gap: 10 }}>
        <TextField
          label={`${t('addSpot.tags')} (${t('common.optional')})`}
          hint={t('addSpot.tagsHint')}
          placeholder={t('addSpot.tagsPlaceholder')}
          value={tagDraft}
          onChangeText={setTagDraft}
          onSubmitEditing={addTag}
          maxLength={24}
          editable={tags.length < MAX_TAGS}
          right={
            <Pressable accessibilityRole="button" accessibilityLabel={t('addSpot.addTag')} onPress={addTag} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 }}>
              <Icon name="plus" size={22} color={c.tint} strokeWidth={2.6} />
            </Pressable>
          }
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4 }}>
          {tags.map((tag) => (
            <Pressable
              key={tag}
              accessibilityRole="button"
              accessibilityLabel={t('addSpot.removeTag', { tag })}
              onPress={() => setTags(tags.filter((x) => x !== tag))}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: c.tintSoft }}
            >
              <Txt variant="subhead" color={c.tintSoftText}>{tag}</Txt>
              <Icon name="close" size={14} color={c.tintSoftText} />
            </Pressable>
          ))}
        </View>
      </View>

      <FormError message={formError} />
      <PillButton title={submitLabel} onPress={submit} loading={busy} />
    </NavScreen>
  );
}
