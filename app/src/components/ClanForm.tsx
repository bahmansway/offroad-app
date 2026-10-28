import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Cell, FormError, LinkButton, PillButton, Section, SegmentedControl, SheetScreen, TextField, Txt, goBack, useTheme } from './ui';
import { ClanLogo } from './ClanBits';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { clanErrorMessage, errorMessage } from '../lib/errors';
import { pickPhoto } from '../lib/photos';
import { hasErrors, validateClan } from '../lib/validation';
import { successFeedback } from '../lib/haptics';
import type { Clan, ClanInput } from '../lib/types';

/** "Klan yarat" and "Edit clan" sheet. With `clan` = edit mode (leader only; adds logo controls). */
export function ClanForm({ clan, onSaved, fallback }: { clan?: Clan; onSaved: (c: Clan) => void; fallback: string }) {
  const { t } = useI18n();
  const { c } = useTheme();
  const [name, setName] = useState(clan?.name ?? '');
  const [tag, setTag] = useState(clan?.tag ?? '');
  const [city, setCity] = useState(clan?.city ?? '');
  const [description, setDescription] = useState(clan?.description ?? '');
  const [isOpen, setIsOpen] = useState(clan?.isOpen ?? true);
  const [logoUrl, setLogoUrl] = useState(clan?.logoUrl ?? null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errs = validateClan({ name, tag, city, description });
  const show = (k: keyof typeof errs) => (touched && errs[k] ? t(errs[k]!) : null);

  async function save() {
    setTouched(true);
    if (hasErrors(errs)) return;
    setBusy(true);
    setError(null);
    const body: ClanInput = {
      name: name.trim(), tag: tag.trim().toUpperCase(), description: description.trim(), city: city.trim() || null, isOpen,
    };
    try {
      const saved = clan ? await api.updateClan(clan.id, body) : await api.createClan(body);
      successFeedback();
      onSaved({ ...saved, logoUrl: clan ? logoUrl : saved.logoUrl });
    } catch (e) {
      setError(clanErrorMessage(e, t, 'save'));
    } finally {
      setBusy(false);
    }
  }

  async function changeLogo() {
    if (!clan) return;
    setError(null);
    const res = await pickPhoto('avatar');
    if (!res.ok) {
      if (res.reason !== 'cancelled') setError(t(res.reason === 'denied' ? 'profile.photoDenied' : res.reason === 'tooBig' ? 'profile.photoTooBig' : 'profile.photoFailed'));
      return;
    }
    setLogoBusy(true);
    try {
      const r = await api.uploadClanLogo(clan.id, res.bytes);
      setLogoUrl(r.logoUrl);
    } catch (e) {
      setError(errorMessage(e, t, 'photo'));
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    if (!clan) return;
    setLogoBusy(true);
    try {
      await api.deleteClanLogo(clan.id);
      setLogoUrl(null);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <SheetScreen
      title={clan ? t('clan.editTitle') : t('clan.createTitle')}
      cancelLabel={t('common.cancel')}
      onBack={() => goBack(fallback)}
      right={clan ? <LinkButton title={t('common.save')} onPress={save} /> : null}
      contentStyle={{ paddingHorizontal: 16 }}
      footer={!clan ? <PillButton title={t('clan.create')} onPress={save} loading={busy} /> : undefined}
    >
      {clan ? (
        <View style={{ alignItems: 'center', gap: 4 }}>
          <View>
            <ClanLogo clan={{ id: clan.id, tag: tag.trim().toUpperCase() || clan.tag, logoUrl }} size={88} />
            {logoBusy ? <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={c.tint} /></View> : null}
          </View>
          <LinkButton title={logoUrl ? t('clan.changeLogo') : t('clan.addLogo')} onPress={changeLogo} />
        </View>
      ) : null}
      <TextField label={t('clan.name')} placeholder={t('clan.namePlaceholder')} value={name} onChangeText={setName} maxLength={40} error={show('name')} />
      <TextField
        label={t('clan.tag')}
        placeholder={t('clan.tagPlaceholder')}
        value={tag}
        onChangeText={(s) => setTag(s.replace(/\s/g, '').toUpperCase())}
        maxLength={5}
        autoCapitalize="characters"
        autoCorrect={false}
        hint={t('clan.tagHint')}
        error={show('tag')}
      />
      <TextField label={t('clan.city')} placeholder={t('clan.cityPlaceholder')} value={city} onChangeText={setCity} maxLength={60} error={show('city')} />
      <TextField
        label={t('clan.description')}
        placeholder={t('clan.descriptionPlaceholder')}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={500}
        error={show('description')}
        hint={`${description.trim().length}/500`}
      />
      <View style={{ gap: 8 }}>
        <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 0.2 }}>{t('clan.joinType')}</Txt>
        <SegmentedControl
          label={t('clan.joinType')}
          value={isOpen ? 'open' : 'request'}
          onChange={(v) => setIsOpen(v === 'open')}
          options={[{ value: 'open', label: t('clan.open') }, { value: 'request', label: t('clan.request') }]}
          style={{ alignSelf: 'stretch' }}
        />
        <Txt variant="footnote" tone="label2" style={{ paddingHorizontal: 20 }}>{isOpen ? t('clan.openHint') : t('clan.requestHint')}</Txt>
      </View>
      <FormError message={error} />
      {clan && logoUrl ? (
        <Section>
          <Cell title={t('clan.removeLogo')} destructive center chevron={false} onPress={removeLogo} />
        </Section>
      ) : null}
      {busy && clan ? <ActivityIndicator color={c.label2} /> : null}
    </SheetScreen>
  );
}
