import { useSession } from '@/auth/session';
import { ProfileScreen } from '@/features/feed/profile-screen';
import { statsKeys, userKeys } from '@/features/users/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';

export default function MeScreen() {
  const username = useSession().user?.username;
  useInvalidateOnFocus([userKeys.all, statsKeys.all]);
  if (!username) return null;
  return <ProfileScreen username={username} viewer={username} />;
}
