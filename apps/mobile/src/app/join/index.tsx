import Head from 'expo-router/head';

import { JoinCodeScreen } from '@/features/groups/join-screens';

export default function JoinCodeRoute() {
  return (
    <>
      <Head>
        <title>Join a group on Sharkulator</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
      </Head>
      <JoinCodeScreen />
    </>
  );
}
