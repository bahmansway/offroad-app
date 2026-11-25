import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ProfileView } from '../../components/ProfileView';

/** Someone's public profile (also mine, opened from a list). */
export default function UserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProfileView userId={String(id)} />;
}
