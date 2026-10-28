import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { RequireAuth } from '../../components/RequireAuth';
import { photoUri } from '../../components/Rows';
import { Avatar, Cell, FormError, LinkButton, Section, SheetScreen, TextField, goBack, useTheme } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/errors';
import { pickPhoto } from '../../lib/photos';
import { hasErrors, validateProfile } from '../../lib/validation';
import { successFeedback } from '../../lib/haptics';

export default function EditProfileScreen() {
  return <RequireAuth><EditProfile /></RequireAuth>;
}

function EditProfile() {
  const { t } = useI18n();
  const { c } = useTheme();
  const { user, updateUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [city, setCity] = useState(user?.city ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;

  const errs = validateProfile({ displayName, city, bio });
  const show = (k: keyof typeof errs) => (touched && errs[k] ? t(errs[k]!) : null);

  async function save() {
    setTouched(true);
    setError(null);
    if (hasErrors(errs)) return;
    setBusy(true);
    try {
      const me = await api.updateMe({ displayName: displayName.trim(), city: city.trim() || null, bio: bio.trim() || null });
      updateUser(me);
      successFeedback();
      goBack('/profile');
    } catch (e) {
      setError(errorMessage(e, t));
      setBusy(false);
    }
  }

  async function changePhoto() {
    setError(null);
    const res = await pickPhoto('avatar');
    if (!res.ok) {
      if (res.reason !== 'cancelled') setError(t(res.reason === 'denied' ? 'profile.photoDenied' : res.reason === 'tooBig' ? 'profile.photoTooBig' : 'profile.photoFailed'));
      return;
    }
    setPhotoBusy(true);
    try {
      const r = await api.uploadAvatar(res.bytes);
      updateUser({ avatarUrl: r.avatarUrl });
    } catch (e) {
      setError(errorMessage(e, t, 'photo'));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      await api.deleteAvatar();
      updateUser({ avatarUrl: null });
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <SheetScreen
      title={t('profile.edit')}
      cancelLabel={t('common.cancel')}
      onBack={() => goBack('/profile')}
      right={<LinkButton title={t('common.save')} onPress={save} />}
      contentStyle={{ paddingHorizontal: 16 }}
    >
      <View style={{ alignItems: 'center', gap: 4 }}>
        <View>
          <Avatar uri={photoUri(user.avatarUrl)} name={displayName || user.displayName} size={96} />
          {photoBusy ? <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={c.tint} /></View> : null}
        </View>
        <LinkButton title={user.avatarUrl ? t('profile.changePhoto') : t('profile.addPhoto')} onPress={changePhoto} />
      </View>
      <TextField label={t('profile.displayName')} value={displayName} onChangeText={setDisplayName} maxLength={40} autoComplete="nickname" error={show('displayName')} />
      <TextField label={t('profile.city')} placeholder={t('profile.cityPlaceholder')} value={city} onChangeText={setCity} maxLength={60} error={show('city')} />
      <TextField label={t('profile.bio')} placeholder={t('profile.bioPlaceholder')} value={bio} onChangeText={setBio} multiline maxLength={300} error={show('bio')}
        hint={`${bio.trim().length}/300`} />
      <FormError message={error} />
      {user.avatarUrl ? (
        <Section>
          <Cell title={t('profile.removePhoto')} destructive center chevron={false} onPress={removePhoto} />
        </Section>
      ) : null}
      {busy ? <ActivityIndicator color={c.label2} /> : null}
    </SheetScreen>
  );
}
