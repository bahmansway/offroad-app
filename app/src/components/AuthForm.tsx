import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, TopBar, goBack } from './Screen';
import { Button, FormError, H1, IconButton, Muted, TextField } from './ui';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { errorMessage } from '../lib/errors';
import { hasErrors, validateRegister } from '../lib/validation';
import { colors, fonts } from '../lib/theme';


export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { t } = useI18n();
  const { login, register, sessionLost } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const errs = validateRegister({ email, password, displayName });
  const fieldErrs = mode === 'login'
    ? { email: errs.email, password: password.length ? null : 'auth.passwordShort', displayName: null }
    : errs;
  const show = (k: keyof typeof fieldErrs) => (touched && fieldErrs[k] ? t(fieldErrs[k]!) : null);

  async function submit() {
    setTouched(true);
    setFormError(null);
    if (hasErrors(fieldErrs)) return;
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, displayName);
      goBack('/');
    } catch (e) {
      setFormError(errorMessage(e, t, 'auth'));
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === 'login';
  return (
    <Screen>
      <TopBar />
      <Text style={styles.brand}>{t('appName')}</Text>
      <H1>{isLogin ? t('auth.loginTitle') : t('auth.registerTitle')}</H1>
      <Muted>{t('auth.tagline')}</Muted>
      {sessionLost && isLogin ? <FormError message={t('errors.sessionExpired')} /> : null}
      <View style={{ gap: 14, marginTop: 8 }}>
        {!isLogin ? (
          <TextField
            label={t('auth.displayName')}
            hint={t('auth.displayNameHint')}
            value={displayName}
            onChangeText={setDisplayName}
            autoComplete="nickname"
            maxLength={40}
            error={show('displayName')}
          />
        ) : null}
        <TextField
          label={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          maxLength={254}
          inputMode="email"
          error={show('email')}
        />
        <TextField
          label={t('auth.password')}
          hint={isLogin ? undefined : t('auth.passwordHint')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPw}
          autoCapitalize="none"
          autoComplete={isLogin ? 'current-password' : 'new-password'}
          maxLength={128}
          onSubmitEditing={submit}
          error={show('password')}
          right={
            <IconButton
              icon={showPw ? 'eyeOff' : 'eye'}
              label={showPw ? t('auth.hidePassword') : t('auth.showPassword')}
              onPress={() => setShowPw((v) => !v)}
              bg="transparent"
              color={colors.muted}
            />
          }
        />
        <FormError message={formError} />
        <Button title={isLogin ? t('auth.loginButton') : t('auth.registerButton')} onPress={submit} loading={busy} />
        <View style={styles.switchRow}>
          <Muted>{isLogin ? t('auth.noAccount') : t('auth.haveAccount')}</Muted>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.replace(isLogin ? '/register' : '/login')}
            style={styles.link}
          >
            <Text style={styles.linkText}>{isLogin ? t('auth.toRegister') : t('auth.toLogin')}</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { fontFamily: fonts.head, fontSize: 18, letterSpacing: 2, color: colors.accent, marginTop: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  linkText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.accent },
});

