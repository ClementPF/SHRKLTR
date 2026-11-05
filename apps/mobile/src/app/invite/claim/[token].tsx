import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';

import { ClaimScreen } from '@/features/invites/claim-screen';

export default function ClaimRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return (
    <>
      <Head>
        <title>Claim your Sharkulator profile</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
      </Head>
      <ClaimScreen key={token} token={token} />
    </>
  );
}
