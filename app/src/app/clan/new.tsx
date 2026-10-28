import React from 'react';
import { router } from 'expo-router';
import { RequireAuth } from '../../components/RequireAuth';
import { ClanForm } from '../../components/ClanForm';
import { useChat } from '../../lib/chat';

export default function NewClanScreen() {
  const { reload } = useChat();
  return (
    <RequireAuth>
      <ClanForm
        fallback="/clans"
        onSaved={(c) => {
          reload(); // the new clan chat shows up in the list
          router.replace(`/clan/${c.id}`);
        }}
      />
    </RequireAuth>
  );
}
