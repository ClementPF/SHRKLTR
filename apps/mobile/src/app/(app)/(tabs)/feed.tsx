import { HealthStatus } from '@/components/health-status';
import { ScreenPlaceholder } from '@/components/screen-placeholder';

export default function FeedScreen() {
  return (
    <ScreenPlaceholder title="Feed">
      <HealthStatus />
    </ScreenPlaceholder>
  );
}
