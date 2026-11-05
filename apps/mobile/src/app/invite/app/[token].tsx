import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';

import { AppInviteLanding } from '@/features/invites/app-invite-landing';

export default function AppInviteRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return (
    <>
      <Head>
        <title>You are invited to Sharkulator</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
      </Head>
      <AppInviteLanding key={token} token={token} />
    </>
  );
}
