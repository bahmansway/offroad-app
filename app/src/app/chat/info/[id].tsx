import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  Badge, Cell, EmptyState, ErrorState, Icon, LoadingState, NavScreen, PillButton, Section, SwitchCell, TextField, Txt, useTheme,
} from '../../../components/ui';
import { ActionSheet, type SheetAction } from '../../../components/ActionSheet';
import { GroupAvatar, PersonCell } from '../../../components/ChatRows';
import { RequireAuth } from '../../../components/RequireAuth';
import { api } from '../../../lib/api';
import { ApiError } from '../../../lib/apiClient';
import { useAuth } from '../../../lib/auth';
import { useChat } from '../../../lib/chat';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/errors';
import { confirmAsync } from '../../../lib/dialogs';
import { sameId } from '../../../lib/format';
import { successFeedback } from '../../../lib/haptics';
import { pickPhoto } from '../../../lib/photos';
import {
  canEditGroup, GROUP_NAME_MAX, groupErrorMessage, groupMemberActions, groupNameError, nextAdmin, remainingSlots,
} from '../../../lib/groupLogic';
import type { Conversation, ConversationMember } from '../../../lib/types';

/** Group info: photo, name, members, admin tools (rename, photo, add, remove), mute, leave. */
export default function GroupInfoScreen() {
  return <RequireAuth><GroupInfo /></RequireAuth>;
}

function GroupInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { c } = useTheme();
  const { user } = useAuth();
  const chat = useChat();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [members, setMembers] = useState<ConversationMember[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [gone, setGone] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [menuFor, setMenuFor] = useState<ConversationMember | null>(null);
  const [photoMenu, setPhotoMenu] = useState(false);
  const seq = useRef(0);
  const editingRef = useRef(false);
  editingRef.current = editing;

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoadError(null);
    try {
      const [cv, m] = await Promise.all([api.conversation(id), api.conversationMembers(id)]);
      if (my !== seq.current) return;
      setConv(cv);
      setMembers(m.items);
      if (!editingRef.current) setName(cv.title);
    } catch (e) {
      if (my !== seq.current) return;
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setGone(true);
      else setLoadError(e);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const offs = [
      chat.on('groupUpdated', (g) => { if (sameId(g.conversationId, id)) load(); }),
      chat.on('groupRemoved', (g) => { if (sameId(g.conversationId, id)) setGone(true); }),
    ];
    return () => offs.forEach((off) => off());
  }, [chat, id, load]);

  async function act(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    setNote(null);
    try {
      await fn();
      if (ok) {
        successFeedback();
        setNote({ text: ok, error: false });
      }
      await load();
      chat.reload();
    } catch (e) {
      setNote({ text: groupErrorMessage(e, t, (x) => errorMessage(x, t)), error: true });
      if (e instanceof ApiError && [403, 404, 409].includes(e.status)) load();
    } finally {
      setBusy(null);
    }
  }

  if (gone) {
    return (
      <NavScreen fallback="/chat">
        <EmptyState icon="lock" title={t('group.removedFromGroup')} actionLabel={t('chat.title')} onAction={() => router.replace('/chat')} />
      </NavScreen>
    );
  }
  if (!conv || !members) {
    return loadError
      ? <NavScreen fallback="/chat"><ErrorState message={errorMessage(loadError, t)} onRetry={load} /></NavScreen>
      : <LoadingState />;
  }

  const admin = canEditGroup(conv);
  const myId = user?.id;
  const count = members.length;
  const slots = remainingSlots(count);
  const nameErr = groupNameError(name);

  const rename = () => {
    if (nameErr) return setNote({ text: t(nameErr === 'empty' ? 'group.nameEmpty' : 'group.nameTooLong'), error: true });
    act('rename', async () => {
      await api.renameGroup(id, name.trim());
      setEditing(false);
    }, t('group.renamed'));
  };

  const changePhoto = async () => {
    const res = await pickPhoto('avatar');
    if (!res.ok) {
      if (res.reason !== 'cancelled') setNote({ text: t(res.reason === 'denied' ? 'profile.photoDenied' : res.reason === 'tooBig' ? 'profile.photoTooBig' : 'profile.photoFailed'), error: true });
      return;
    }
    act('photo', () => api.uploadGroupAvatar(id, res.bytes));
  };
  const photoActions: SheetAction[] = [
    { label: conv.avatarUrl ? t('group.changePhoto') : t('group.addPhoto'), onPress: changePhoto },
    ...(conv.avatarUrl ? [{ label: t('group.removePhoto'), destructive: true, onPress: () => act('photo', () => api.deleteGroupAvatar(id)) }] : []),
  ];

  const leave = async () => {
    if (!myId) return;
    const heir = conv.isAdmin ? nextAdmin(members, myId) : null;
    const msg = count <= 1 ? t('group.leaveConfirmLast') : heir ? t('group.leaveConfirmAdmin', { name: heir.user.displayName }) : t('group.leaveConfirm');
    if (!(await confirmAsync(msg, t('group.leave'), t('common.cancel'), { destructive: true }))) return;
    setBusy('leave');
    try {
      await api.removeGroupMember(id, myId);
      chat.drop(id);
      router.dismissTo('/chat');
    } catch (e) {
      setNote({ text: groupErrorMessage(e, t, (x) => errorMessage(x, t)), error: true });
      setBusy(null);
    }
  };

  function memberSheet(m: ConversationMember): SheetAction[] {
    return groupMemberActions(conv, m.user.id, myId).map((a): SheetAction => a === 'profile'
      ? { label: t('chat.openProfile'), onPress: () => router.push(`/user/${m.user.id}`) }
      : {
          label: t('group.remove'),
          destructive: true,
          onPress: async () => {
            const n = m.user.displayName;
            if (!(await confirmAsync(t('group.removeConfirm', { name: n }), t('common.remove'), t('common.cancel'), { destructive: true }))) return;
            act(`rm:${m.user.id}`, () => api.removeGroupMember(id, m.user.id), t('group.removed', { name: n }));
          },
        });
  }

  return (
    <NavScreen title={t('group.info')} fallback={`/chat/${id}`}>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <Pressable
          disabled={!admin || busy === 'photo'}
          onPress={() => setPhotoMenu(true)}
          accessibilityRole={admin ? 'button' : undefined}
          accessibilityLabel={admin ? (conv.avatarUrl ? t('group.changePhoto') : t('group.addPhoto')) : undefined}
        >
          <GroupAvatar uri={conv.avatarUrl} size={96} />
          {admin ? (
            <View style={{ position: 'absolute', right: 0, bottom: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: c.tint, borderWidth: 2, borderColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
              {busy === 'photo' ? <ActivityIndicator size="small" color={c.onTint} /> : <Icon name="camera" size={15} color={c.onTint} strokeWidth={2.4} />}
            </View>
          ) : null}
        </Pressable>
        <Txt variant="title1" accessibilityRole="header" center>{conv.title}</Txt>
        <Txt variant="subhead" tone="label2" center>{t('chat.members', { count })}</Txt>
      </View>

      {note ? (
        <Txt variant="footnote" tone={note.error ? 'destructive' : 'label2'} center role={note.error ? 'alert' : undefined} accessibilityLiveRegion="polite">{note.text}</Txt>
      ) : null}

      {admin ? (
        editing ? (
          <View style={{ gap: 10 }}>
            <TextField label={t('group.renameTitle')} value={name} onChangeText={setName} maxLength={GROUP_NAME_MAX + 10} autoFocus returnKeyType="done" onSubmitEditing={rename} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <PillButton title={t('common.cancel')} variant="gray" size="medium" style={{ flex: 1 }} onPress={() => { setEditing(false); setName(conv.title); }} />
              <PillButton title={t('common.save')} size="medium" style={{ flex: 1 }} loading={busy === 'rename'} disabled={name.trim() === conv.title} onPress={rename} />
            </View>
          </View>
        ) : (
          <Section>
            <Cell title={t('group.rename')} left={<Icon name="edit" size={20} color={c.tint} />} action onPress={() => { setName(conv.title); setEditing(true); }} />
            {slots > 0 ? (
              <Cell
                title={t('group.addMembers')}
                subtitle={t('group.slotsLeft', { count: slots })}
                left={<Icon name="invite" size={20} color={c.tint} />}
                action
                onPress={() => router.push(`/chat/add-members/${id}`)}
              />
            ) : <Cell title={t('group.errors.full')} chevron={false} />}
          </Section>
        )
      ) : null}

      <Section header={t('group.members', { count })} footer={admin ? undefined : t('group.adminHint')}>
        {members.map((m) => {
          const me = sameId(m.user.id, myId);
          const actions = groupMemberActions(conv, m.user.id, myId);
          return (
            <PersonCell
              key={m.user.id}
              user={m.user}
              subtitle={me ? t('group.you') : undefined}
              right={m.isAdmin ? <Badge text={t('group.admin')} tone="tint" /> : busy === `rm:${m.user.id}` ? <ActivityIndicator color={c.label2} /> : undefined}
              onPress={me ? undefined : actions.length > 1 ? () => setMenuFor(m) : () => router.push(`/user/${m.user.id}`)}
              accessibilityRole={actions.length > 1 ? 'button' : 'link'}
              accessibilityLabel={[m.user.displayName, me ? t('group.you') : null, m.isAdmin ? t('group.admin') : null].filter(Boolean).join(', ')}
            />
          );
        })}
      </Section>

      <Section>
        <SwitchCell
          title={t('group.muteRow')}
          value={!!conv.muted}
          onValueChange={(v) => act('mute', async () => { await chat.setMuted(id, v); }, v ? t('chat.mutedOn') : t('chat.mutedOff'))}
        />
      </Section>

      <Section>
        <Cell title={t('group.leave')} destructive center chevron={false} disabled={busy === 'leave'} onPress={leave} />
      </Section>

      <ActionSheet visible={!!menuFor} title={menuFor ? t('group.memberActions', { name: menuFor.user.displayName }) : undefined}
        actions={menuFor ? memberSheet(menuFor) : []} onClose={() => setMenuFor(null)} />
      <ActionSheet visible={photoMenu} actions={photoActions} onClose={() => setPhotoMenu(false)} />
    </NavScreen>
  );
}
