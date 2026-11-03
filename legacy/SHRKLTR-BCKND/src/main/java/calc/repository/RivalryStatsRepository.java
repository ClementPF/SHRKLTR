package calc.repository;

import calc.entity.RivalryStats;
import calc.entity.Stats;
import calc.entity.Tournament;
import calc.entity.User;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import javax.persistence.NamedQuery;
import java.util.List;

@Repository
public interface RivalryStatsRepository extends CrudRepository<RivalryStats, Long> {
    List<RivalryStats> findByTournament(Tournament tournament);
    List<RivalryStats> findByTournamentOrderByScoreDesc(Tournament tournament);
    List<RivalryStats> findByUser(User user);
    List<RivalryStats> findByUserUserId(Long userId);
    List<RivalryStats> findByRival(User user);
    List<RivalryStats> findByRivalUserId(Long userId);
    public List<RivalryStats> findByUserUserIdAndTournamentTournamentId(@Param("userId") Long userId, @Param("tournamentId") Long tournamentId);
    public List<RivalryStats> findByUserUserNameAndTournamentName(@Param("username") String username, @Param("tournamentName") String tournamentId);
    public List<RivalryStats> findByStatsId(@Param("statsId") Long statsId);
    public List<RivalryStats> findByRivalUserIdAndTournamentTournamentId(@Param("rivalUserId") Long userId, @Param("tournamentId") Long tournamentId);
    public List<RivalryStats> findByRivalUserNameAndTournamentName(@Param("rivalUsername") String username, @Param("tournamentName") String tournamentName);
    public RivalryStats findByUserUserIdAndRivalUserIdAndTournamentTournamentId(@Param("userId") Long userId, @Param("rivalUserId") Long rivalUserId, @Param("tournamentId") Long tournamentId);
    public RivalryStats findByUserUserNameAndRivalUserNameAndTournamentName(@Param("userName") String username, @Param("rivalUsername") String rivalUsername, @Param("tournamentName") String tournamentName);
    public RivalryStats findByStatsStatsIdAndRivalUserId(@Param("statsId") Long statsId, @Param("rivalUserId") Long rivalUserId);
}