import React from 'react';
import { Redirect } from 'expo-router';
import { RequireAuth } from '../components/RequireAuth';
import { useAuth } from '../lib/auth';

/** v6: friends became follows. Old links (/friends, old notifications) open my followers list. */
export default function FriendsScreen() {
  return <RequireAuth><ToFollowers /></RequireAuth>;
}

function ToFollowers() {
  const { user } = useAuth();
  return <Redirect href={{ pathname: '/follows/[id]', params: { id: String(user!.id), tab: 'followers' } }} />;
}
