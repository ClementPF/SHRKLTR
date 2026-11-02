import { Redirect } from 'expo-router';

import { useSession } from '@/auth/session';

export default function Index() {
  const { session } = useSession();
  return <Redirect href={session ? '/feed' : '/login'} />;
}
