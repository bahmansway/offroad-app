import React, { useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FormError, Icon, NavBar, PillButton, Txt, goBack, useTheme } from '../../components/ui';
import { RequireAuth } from '../../components/RequireAuth';
import { ActionSheet } from '../../components/ActionSheet';
import { PostMetaFields, type MetaValue } from '../../components/posts/PostMetaFields';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/apiClient';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/errors';
import { confirmAsync } from '../../lib/dialogs';
import { successFeedback } from '../../lib/haptics';
import { addPhotos, MAX_CAPTION, MAX_POST_PHOTOS, movePhoto, uploadProgress } from '../../lib/postsLogic';
import { discardDraft, freshUpload, pickFromGallery, takePhoto, uploadPost, type PickedPhoto, type PickOutcome } from '../../lib/postUpload';
import { radius, type } from '../../lib/theme';

/** "Yeni paylaşım": 1) pick up to 6 photos and order them (first = cover), 2) caption + car + road, 3) share. */
export default function NewPostScreen() {
  return <RequireAuth><NewPost /></RequireAuth>;
}

function NewPost() {
  const { t } = useI18n();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ spotId?: string; spotName?: string }>();
  const [step, setStep] = useState<'pick' | 'caption'>('pick');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [caption, setCaption] = useState('');
  const [meta, setMeta] = useState<MetaValue>({ car: null, spot: params.spotId ? { id: params.spotId, label: params.spotName ?? '' } : null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; stage: 'photos' | 'publish' } | null>(null);
  const [failed, setFailed] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const upload = useRef(freshUpload());
  /** set synchronously, so a fast double tap on Paylaş can never start two uploads (state updates are async) */
  const sharing = useRef(false);

  // a road given by the spot page: show its name
  useEffect(() => {
    if (params.spotId && !params.spotName) api.spot(params.spotId).then((s) => setMeta((m) => ({ ...m, spot: { id: s.id, label: s.name } }))).catch(() => {});
  }, [params.spotId, params.spotName]);

  function handle(r: PickOutcome) {
    if (r.ok) { setPhotos((cur) => addPhotos(cur, r.photos)); setError(null); return; }
    if (r.reason === 'denied') setError(t('post.new.denied'));
    else if (r.reason === 'failed') setError(t('post.new.pickFailed'));
  }
  const gallery = async () => {
    if (photos.length >= MAX_POST_PHOTOS) return setError(t('post.new.tooMany'));
    handle(await pickFromGallery(photos.length));
  };
  const camera = async () => {
    if (photos.length >= MAX_POST_PHOTOS) return setError(t('post.new.tooMany'));
    const r = await takePhoto();
    if (!r.ok && r.reason === 'denied') return setError(t('post.new.cameraDenied'));
    handle(r);
  };

  async function cancel() {
    if (busy || sharing.current) return;
    if ((photos.length || caption.trim()) && !(await confirmAsync(t('post.new.discardConfirm'), t('post.new.discard'), t('common.cancel'), { destructive: true }))) return;
    // a draft left by a failed try: delete it now (the server would only clear it after 24 h)
    await discardDraft(upload.current);
    upload.current = freshUpload();
    goBack('/');
  }

  async function share() {
    if (sharing.current || busy || !photos.length) return;
    sharing.current = true;
    setBusy(true);
    setError(null);
    setFailed(false);
    try {
      const post = await uploadPost(
        upload.current,
        { caption: caption.trim(), carId: meta.car?.id ?? null, spotId: meta.spot?.id ?? null },
        photos,
        (done, total, stage) => setProgress({ done, total, stage }),
      );
      successFeedback();
      router.replace(`/post/${post.id}`);
    } catch (e) {
      setFailed(true);
      setProgress(null);
      if (e instanceof ApiError && e.code === 'RATE_LIMITED') setError(t('post.new.rateLimited'));
      else if (e instanceof ApiError) setError(errorMessage(e, t, 'photo'));
      else setError(t('post.new.failed'));
      sharing.current = false;
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <View style={{ paddingTop: insets.top, backgroundColor: c.bg }}>
      <View style={{ width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        {step === 'pick'
          ? <NavBar title={t('post.new.title')} cancelLabel={t('common.cancel')} onBack={cancel} />
          : <NavBar title={t('post.new.title')} backLabel={t('common.back')} onBack={() => !busy && setStep('pick')} />}
      </View>
    </View>
  );

  if (step === 'pick') {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        {header}
        <PickStep
          photos={photos}
          onCamera={camera}
          onGallery={gallery}
          onTapPhoto={(i) => setMenuFor(i)}
        />
        <FormError message={error} />
        <View style={{ backgroundColor: c.sheet, borderTopWidth: 0.5, borderTopColor: c.separator, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 + insets.bottom, gap: 10 }}>
          <View style={{ width: '100%', maxWidth: 640, alignSelf: 'center', gap: 10 }}>
            {photos.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, maxWidth: '62%' }} contentContainerStyle={{ gap: 10 }}>
                  {photos.map((p, i) => <SmallThumb key={p.key} uri={p.uri} size={56} label={i === 0 ? t('post.new.cover') : String(i + 1)} />)}
                </ScrollView>
                <Txt variant="footnote" tone="label2" style={{ flex: 1 }}>{t('post.new.reorderHint')}</Txt>
              </View>
            ) : null}
            <PillButton
              title={photos.length ? t('post.new.next', { count: photos.length }) : t('post.new.gallery')}
              icon={photos.length ? undefined : 'photo'}
              size="medium"
              onPress={photos.length ? () => { setError(null); setStep('caption'); } : gallery}
            />
          </View>
        </View>
        <ActionSheet
          visible={menuFor !== null}
          title={menuFor !== null ? t('post.new.photoA11y', { n: menuFor + 1 }) : undefined}
          onClose={() => setMenuFor(null)}
          actions={menuFor === null ? [] : [
            ...(menuFor > 0 ? [{ label: t('post.new.makeCover'), onPress: () => setPhotos((cur) => movePhoto(cur, menuFor, 0)) }] : []),
            ...(menuFor > 0 ? [{ label: t('post.new.moveEarlier'), onPress: () => setPhotos((cur) => movePhoto(cur, menuFor, menuFor - 1)) }] : []),
            ...(menuFor < photos.length - 1 ? [{ label: t('post.new.moveLater'), onPress: () => setPhotos((cur) => movePhoto(cur, menuFor, menuFor + 1)) }] : []),
            { label: t('post.new.remove'), destructive: true, onPress: () => setPhotos((cur) => cur.filter((_, i) => i !== menuFor)) },
          ]}
        />
      </View>
    );
  }

  const pct = progress ? uploadProgress(progress.done, progress.total, false) : 0;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {header}
      <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 640, alignSelf: 'center', padding: 16, paddingTop: 8, gap: 18, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} accessibilityLabel={t('post.new.photos')}>
          {photos.map((p, i) => <SmallThumb key={p.key} uri={p.uri} size={78} label={i === 0 ? t('post.new.cover') : String(i + 1)} />)}
          {photos.length < MAX_POST_PHOTOS ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('post.new.galleryA11y', { n: photos.length })}
              onPress={() => !busy && gallery()}
              style={({ pressed }) => [{ width: 78, height: 78, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.label3, alignItems: 'center', justifyContent: 'center', gap: 2 }, pressed && { opacity: 0.6 }]}
            >
              <Icon name="plus" size={22} color={c.label2} strokeWidth={2.2} />
              <Txt variant="caption" tone="label2" style={{ fontWeight: '600' }}>{`${photos.length} / ${MAX_POST_PHOTOS}`}</Txt>
            </Pressable>
          ) : null}
        </ScrollView>

        <View style={{ backgroundColor: c.card, borderRadius: radius.card, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 6 }}>
          <Txt variant="footnote" tone="label2" style={{ fontWeight: '600' }} nativeID="captionLabel">{t('post.new.caption')}</Txt>
          <TextInput
            value={caption}
            onChangeText={(s) => setCaption(s.slice(0, MAX_CAPTION))}
            placeholder={t('post.new.captionPlaceholder')}
            placeholderTextColor={c.label2}
            multiline
            maxLength={MAX_CAPTION}
            accessibilityLabel={t('post.new.caption')}
            editable={!busy}
            style={[type.body, { color: c.label, minHeight: 110, textAlignVertical: 'top', outlineWidth: 0 } as object]}
          />
          <Txt variant="footnote" tone="label2" style={{ alignSelf: 'flex-end' }}>{t('post.new.counter', { n: caption.length, max: MAX_CAPTION })}</Txt>
        </View>

        <PostMetaFields value={meta} onChange={setMeta} />
        <FormError message={error} />
      </ScrollView>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 + insets.bottom, gap: 10, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        {progress ? (
          <View style={{ gap: 6 }} accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }} accessibilityLabel={progress.stage === 'publish' ? t('post.new.publishing') : t('post.new.uploading', { done: Math.min(progress.done + 1, progress.total), total: progress.total })}>
            <Txt variant="footnote" tone="label2" center>{progress.stage === 'publish' ? t('post.new.publishing') : t('post.new.uploading', { done: Math.min(progress.done + 1, progress.total), total: progress.total })}</Txt>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: c.fill, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(4, pct * 100)}%`, height: 4, backgroundColor: c.tint }} />
            </View>
          </View>
        ) : null}
        <PillButton title={failed ? t('common.retry') : t('post.new.share')} onPress={share} loading={busy} disabled={!photos.length} />
      </View>
    </KeyboardAvoidingView>
  );
}

function PickStep({ photos, onCamera, onGallery, onTapPhoto }: {
  photos: PickedPhoto[]; onCamera: () => void; onGallery: () => void; onTapPhoto: (i: number) => void;
}) {
  const { t } = useI18n();
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const w = Math.min(width, 640);
  const size = Math.floor((w - 4) / 3);
  const full = photos.length >= MAX_POST_PHOTOS;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ width: w, alignSelf: 'center' }}>
      <View style={{ height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 16 }}>
        <Txt variant="headline" accessibilityRole="header">{t('post.new.photos')}</Txt>
        <Txt variant="subhead" tone="label2">{t('post.new.upTo')}</Txt>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
        <Tile size={size} icon="camera" label={t('post.new.camera')} onPress={onCamera} disabled={full} />
        <Tile size={size} icon="photo" label={t('post.new.gallery')} a11y={t('post.new.galleryA11y', { n: photos.length })} onPress={onGallery} disabled={full} />
        {photos.map((p, i) => (
          <Pressable
            key={p.key}
            accessibilityRole="button"
            accessibilityLabel={i === 0 ? t('post.new.photoCoverA11y') : t('post.new.photoA11y', { n: i + 1 })}
            onPress={() => onTapPhoto(i)}
            style={({ pressed }) => [{ width: size, height: size }, pressed && { opacity: 0.8 }]}
          >
            <Image source={{ uri: p.uri }} style={{ width: size, height: size }} resizeMode="cover" accessible={false} />
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderWidth: 3, borderColor: c.tint }} />
            <View pointerEvents="none" style={{ position: 'absolute', right: 8, top: 8, width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center' }}>
              <Txt style={{ fontSize: 14, fontWeight: '800', lineHeight: 18 }} color={c.onTint}>{String(i + 1)}</Txt>
            </View>
          </Pressable>
        ))}
      </View>
      {!photos.length ? <Txt variant="subhead" tone="label2" center style={{ padding: 24 }}>{t('post.new.emptyPick')}</Txt> : null}
    </ScrollView>
  );
}

function Tile({ size, icon, label, a11y, onPress, disabled }: { size: number; icon: 'camera' | 'photo'; label: string; a11y?: string; onPress: () => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{ width: size, height: size, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center', gap: 6 }, (pressed || disabled) && { opacity: 0.5 }]}
    >
      <Icon name={icon} size={30} color={c.label} strokeWidth={1.8} />
      <Txt variant="footnote" style={{ fontWeight: '600' }}>{label}</Txt>
    </Pressable>
  );
}

function SmallThumb({ uri, size, label }: { uri: string; size: number; label: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size > 60 ? 14 : 12, overflow: 'hidden' }} accessible accessibilityLabel={label}>
      <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="cover" accessible={false} />
      <View style={{ position: 'absolute', left: 4, bottom: 4, height: 18, paddingHorizontal: 6, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center' }}>
        <Txt style={{ fontSize: 11, fontWeight: '700', lineHeight: 14, color: '#FFFFFF' }}>{label}</Txt>
      </View>
    </View>
  );
}
