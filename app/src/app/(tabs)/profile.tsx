import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../components/Screen';
import { Body, Button, Card, Eyebrow, H1, H2, Segmented } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { confirmAsync } from '../../lib/dialogs';
import { formatDate } from '../../lib/format';
import { colors, fonts } from '../../lib/theme';
import type { Lang } from '../../lib/format';

export default function ProfileScreen() {
  const { t, lang, setLang } = useI18n();
  const { user, logout, offline, retry } = useAuth();

  async function doLogout() {
    if (await confirmAsync(t('profile.logoutConfirm'), t('profile.logout'), t('common.cancel'))) await logout();
  }

  return (
    <Screen>
      <H1>{t('profile.title')}</H1>

      {user ? (
        <Card>
          <H2>{t('profile.myInfo')}</H2>
          <Row label={t('profile.displayName')} value={user.displayName} />
          {user.email ? <Row label={t('profile.email')} value={user.email} /> : null}
          <Row label={t('profile.memberSince')} value={formatDate(user.createdAt)} />
          <Button title={t('profile.publicProfile')} variant="secondary" icon="user" onPress={() => router.push(`/user/${user.id}`)} />
        </Card>
      ) : offline ? (
        <Card>
          <Body>{t('errors.offline')}</Body>
          <Button title={t('common.retry')} onPress={retry} />
        </Card>
      ) : (
        <Card>
          <Body>{t('common.loginRequired')}</Body>
          <Button title={t('common.login')} onPress={() => router.push('/login')} />
          <Button title={t('auth.registerTitle')} variant="secondary" onPress={() => router.push('/register')} />
        </Card>
      )}

      <Card>
        <Segmented<Lang>
          label={t('profile.language')}
          value={lang}
          onChange={setLang}
          options={[
            { value: 'az', label: 'Azərbaycanca', a11y: 'Azərbaycanca' },
            { value: 'en', label: 'English', a11y: 'English' },
          ]}
        />
      </Card>

      {user ? <Button title={t('profile.logout')} icon="logout" variant="danger" onPress={doLogout} /> : null}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Eyebrow>{label}</Eyebrow>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2, paddingVertical: 4 },
  value: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
});
