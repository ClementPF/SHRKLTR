import { useSession } from '@/auth/session';
import { ProfileScreen } from '@/features/feed/profile-screen';

export default function MeScreen() {
  const username = useSession().user?.username;
  if (!username) return null;
  return <ProfileScreen username={username} viewer={username} />;
}
