import { FeedScreen } from '@/features/feed/feed-screen';
import { statsKeys, userKeys } from '@/features/users/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';

export default function FeedRoute() {
  useInvalidateOnFocus([userKeys.all, statsKeys.all]);
  return <FeedScreen />;
}
