import { Redirect, useLocalSearchParams } from 'expo-router';

/** Share link /p/:id (served the web app by the server) → the post page. */
export default function ShortPostLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/post/${encodeURIComponent(String(id ?? ''))}`} />;
}
