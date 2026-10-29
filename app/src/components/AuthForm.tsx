import { Wordmark } from './Brand';
import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { NavScreen, goBack } from './ui/Screen';
import { PillButton, IconButton, LinkButton } from './ui/Button';
import { TextField } from './ui/Controls';
import { FormError } from './ui/States';
import { Txt } from './ui/Text';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/themeContext';
import { errorMessage } from '../lib/errors';
import { hasErrors, validateRegister } from '../lib/validation';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { t } = useI18n();
  const { c } = useTheme();
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
    <NavScreen>
      <View style={{ gap: 6, paddingHorizontal: 4 }}>
        <Wordmark height={26} style={{ marginBottom: 6 }} />
        <Txt variant="largeTitle" accessibilityRole="header">{isLogin ? t('auth.loginTitle') : t('auth.registerTitle')}</Txt>
        <Txt variant="subhead" tone="label2">{t('auth.tagline')}</Txt>
      </View>
      {sessionLost && isLogin ? <FormError message={t('errors.sessionExpired')} /> : null}
      <View style={{ gap: 16 }}>
        {!isLogin ? (
          <TextField label={t('auth.displayName')} hint={t('auth.displayNameHint')} value={displayName} onChangeText={setDisplayName}
            autoComplete="nickname" maxLength={40} error={show('displayName')} />
        ) : null}
        <TextField label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false}
          keyboardType="email-address" autoComplete="email" maxLength={254} inputMode="email" error={show('email')} />
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
            <IconButton icon={showPw ? 'eyeOff' : 'eye'} label={showPw ? t('auth.hidePassword') : t('auth.showPassword')}
              onPress={() => setShowPw((v) => !v)} color={c.label2} style={{ backgroundColor: 'transparent', marginRight: -10 }} />
          }
        />
        <FormError message={formError} />
        <PillButton title={isLogin ? t('auth.loginButton') : t('auth.registerButton')} onPress={submit} loading={busy} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, flexWrap: 'wrap' }}>
          <Txt variant="subhead" tone="label2">{isLogin ? t('auth.noAccount') : t('auth.haveAccount')}</Txt>
          <LinkButton title={isLogin ? t('auth.toRegister') : t('auth.toLogin')} onPress={() => router.replace(isLogin ? '/register' : '/login')} />
        </View>
      </View>
    </NavScreen>
  );
}
