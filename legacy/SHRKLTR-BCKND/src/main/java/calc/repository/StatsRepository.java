package calc.repository;

import calc.entity.RivalryStats;
import calc.entity.Stats;
import calc.entity.Tournament;
import calc.entity.User;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface StatsRepository extends CrudRepository<Stats, Long> {
    List<Stats> findByTournament(Tournament tournament);
    List<Stats> findByTournamentOrderByScoreDesc(Tournament tournament);
    List<Stats> findByUser(User user);
    List<Stats> findByUserId(Long userId);
    //public Stats findByUserUserNameAndTournamentName(@Param("user") User user, @Param("tournament") Tournament tournament);
    public Stats findByUserUserIdAndTournamentTournamentId(@Param("userId") Long userId, @Param("tournamentId") Long tournamentId);
    public Stats findByUserUserNameAndTournamentName(@Param("username") String username, @Param("tournamentName") String tournamentId);
}