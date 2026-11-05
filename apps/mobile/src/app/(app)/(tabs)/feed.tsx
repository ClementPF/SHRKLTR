import { achievementKeys } from '@/features/achievements/queries';
import { FeedScreen } from '@/features/feed/feed-screen';
import { notificationKeys } from '@/features/notifications/queries';
import { statsKeys, userKeys } from '@/features/users/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';

export default function FeedRoute() {
  useInvalidateOnFocus([userKeys.all, statsKeys.all, notificationKeys.all, achievementKeys.all]);
  return <FeedScreen />;
}
