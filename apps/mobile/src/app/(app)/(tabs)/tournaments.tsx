import { TournamentsScreen } from '@/features/tournaments/tournaments-screen';
import { tournamentKeys } from '@/features/tournaments/queries';
import { useInvalidateOnFocus } from '@/lib/use-invalidate-on-focus';

export default function TournamentsRoute() {
  useInvalidateOnFocus([tournamentKeys.all]);
  return <TournamentsScreen />;
}
