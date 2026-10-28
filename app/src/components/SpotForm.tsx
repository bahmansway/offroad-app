import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import SpotMap from './map/Map';
import type { MapHandle } from './map/shared';
import { Screen, TopBar } from './Screen';
import { Button, FormError, Muted, Segmented, TextField, s as ui } from './ui';
import { Icon } from './Icon';
import { useI18n } from '../lib/i18n';
import { errorMessage } from '../lib/errors';
import { between, normalizeTag } from '../lib/validation';
import { colors, fonts, levelColors, radius } from '../lib/theme';
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
      <Screen scroll={false} padded={false}>
        <View style={styles.pickHead}>
          <TopBar title={title} />
          <Text style={ui.body}>{t('addSpot.pickTitle')}</Text>
          <Muted style={{ fontSize: 13 }}>{t('addSpot.pickHint')}</Muted>
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
        <View style={styles.pickFoot}>
          <Text style={ui.muted} accessibilityLiveRegion="polite">
            {picked ? t('addSpot.pinPlaced', { lat: picked.lat.toFixed(4), lng: picked.lng.toFixed(4) }) : ' '}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title={t('addSpot.useCenter')} icon="pin" variant="secondary" style={{ flex: 1 }} onPress={useCenter} />
            <Button title={t('addSpot.next')} disabled={!picked} style={{ flex: 1 }} onPress={() => setStep('form')} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title={title} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('addSpot.changeLocation')}
        onPress={() => setStep('pick')}
        style={styles.locRow}
      >
        <Icon name="pin" size={20} color={colors.accent} />
        <Text style={[ui.body, { flex: 1 }]}>{picked ? `${picked.lat.toFixed(4)}, ${picked.lng.toFixed(4)}` : '—'}</Text>
        <Text style={styles.linkText}>{t('addSpot.changeLocation')}</Text>
      </Pressable>

      <Segmented
        label={t('addSpot.type')}
        value={type}
        onChange={setType}
        options={[{ value: 'trail', label: t('spot.trail') }, { value: 'camp', label: t('spot.camp') }]}
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
        <View style={ui.field}>
          <Text style={ui.label}>{t('addSpot.level')}</Text>
          <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={t('addSpot.level')}>
            {[1, 2, 3, 4, 5].map((n) => {
              const on = level === n;
              return (
                <Pressable
                  key={n}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${n} — ${d.levels.names[n - 1]}: ${d.levels.explain[n - 1]}`}
                  onPress={() => setLevel(n)}
                  style={[styles.levelOpt, on && { borderColor: levelColors[n - 1], backgroundColor: colors.surface2 }]}
                >
                  <View style={[styles.levelNum, { backgroundColor: levelColors[n - 1] }]}>
                    <Text style={styles.levelNumText}>{n}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[ui.body, { fontFamily: fonts.semibold }]}>{d.levels.names[n - 1]}</Text>
                    <Text style={ui.hint}>{d.levels.explain[n - 1]}</Text>
                  </View>
                  {on ? <Icon name="star" size={18} color={levelColors[n - 1]} fill={levelColors[n - 1]} /> : null}
                </Pressable>
              );
            })}
          </View>
          {err('level') ? <Text style={ui.error} role="alert">{err('level')}</Text> : null}
        </View>
      ) : null}

      <TextField label={`${t('addSpot.season')} (${t('common.optional')})`} placeholder={t('addSpot.seasonPlaceholder')} value={season} onChangeText={setSeason} maxLength={40} error={err('season')} />

      <View style={ui.field}>
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
            <Pressable accessibilityRole="button" accessibilityLabel={t('addSpot.addTag')} onPress={addTag} style={styles.tagAdd}>
              <Icon name="plus" size={20} color={colors.accent} />
            </Pressable>
          }
        />
        <View style={styles.tags}>
          {tags.map((tag) => (
            <Pressable
              key={tag}
              accessibilityRole="button"
              accessibilityLabel={t('addSpot.removeTag', { tag })}
              onPress={() => setTags(tags.filter((x) => x !== tag))}
              style={styles.tag}
            >
              <Text style={styles.tagText}>{tag}</Text>
              <Icon name="close" size={14} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      </View>

      <FormError message={formError} />
      <Button title={submitLabel} onPress={submit} loading={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pickHead: { padding: 16, gap: 8 },
  pickFoot: { padding: 16, gap: 10, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.line },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  linkText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.accent },
  levelOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, padding: 10, borderRadius: radius.md, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surface },
  levelNum: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  levelNumText: { fontFamily: fonts.head, fontSize: 20, color: colors.onAccent },
  tagAdd: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 18, backgroundColor: colors.surface2 },
  tagText: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
});
