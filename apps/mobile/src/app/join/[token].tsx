import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';

import { JoinLinkScreen } from '@/features/groups/join-screens';

export default function JoinLinkRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return (
    <>
      <Head>
        <title>Join a group on Sharkulator</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
      </Head>
      <JoinLinkScreen key={token} token={token} />
    </>
  );
}
