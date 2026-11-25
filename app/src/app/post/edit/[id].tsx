import React, { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ErrorState, FormError, LoadingState, PillButton, SheetScreen, Txt, goBack, useTheme } from '../../../components/ui';
import { RequireAuth } from '../../../components/RequireAuth';
import { NotOwner } from '../../../components/NotOwner';
import { PostMetaFields, type MetaValue } from '../../../components/posts/PostMetaFields';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/errors';
import { successFeedback } from '../../../lib/haptics';
import { MAX_CAPTION } from '../../../lib/postsLogic';
import { sameId } from '../../../lib/format';
import { radius, type } from '../../../lib/theme';
import type { Post } from '../../../lib/types';

/** Edit a post's caption, car and road (author only). Photos stay as they are. */
export default function EditPostScreen() {
  return <RequireAuth><EditPost /></RequireAuth>;
}

function EditPost() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { c } = useTheme();
  const { user } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [caption, setCaption] = useState('');
  const [meta, setMeta] = useState<MetaValue>({ car: null, spot: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    api.post(id).then((p) => {
      setPost(p);
      setCaption(p.caption);
      setMeta({
        car: p.car ? { id: p.car.id, label: `${p.car.make} ${p.car.model} · ${p.car.year}` } : null,
        spot: p.spot ? { id: p.spot.id, label: p.spot.name } : null,
      });
    }).catch(setLoadError);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id]);

  const close = () => goBack(`/post/${id}`);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updatePost(id, { caption: caption.trim(), carId: meta.car?.id ?? null, spotId: meta.spot?.id ?? null });
      successFeedback();
      close();
    } catch (e) {
      setError(errorMessage(e, t, 'create'));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <SheetScreen title={t('post.editTitle')} cancelLabel={t('common.cancel')} onBack={close}><ErrorState message={errorMessage(loadError, t)} onRetry={load} /></SheetScreen>;
  if (!post) return <LoadingState />;
  if (!sameId(post.author.id, user?.id)) return <NotOwner fallback={`/post/${id}`} />;

  return (
    <SheetScreen
      title={t('post.editTitle')}
      cancelLabel={t('common.cancel')}
      onBack={close}
      contentStyle={{ paddingHorizontal: 16 }}
      footer={<PillButton title={t('common.save')} onPress={save} loading={busy} />}
    >
      <View style={{ backgroundColor: c.card, borderRadius: radius.card, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 6 }}>
        <Txt variant="footnote" tone="label2" style={{ fontWeight: '600' }}>{t('post.new.caption')}</Txt>
        <TextInput
          value={caption}
          onChangeText={(s) => setCaption(s.slice(0, MAX_CAPTION))}
          placeholder={t('post.new.captionPlaceholder')}
          placeholderTextColor={c.label2}
          multiline
          maxLength={MAX_CAPTION}
          accessibilityLabel={t('post.new.caption')}
          style={[type.body, { color: c.label, minHeight: 110, textAlignVertical: 'top', outlineWidth: 0 } as object]}
        />
        <Txt variant="footnote" tone="label2" style={{ alignSelf: 'flex-end' }}>{t('post.new.counter', { n: caption.length, max: MAX_CAPTION })}</Txt>
      </View>
      <PostMetaFields value={meta} onChange={setMeta} />
      <FormError message={error} />
    </SheetScreen>
  );
}
