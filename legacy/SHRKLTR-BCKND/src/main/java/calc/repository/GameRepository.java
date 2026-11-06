package calc.repository;

import calc.entity.Game;
import calc.entity.User;
import calc.entity.Stats;
import calc.entity.Tournament;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import javax.persistence.EntityManager;
import javax.persistence.NamedQueries;
import javax.persistence.NamedQuery;
import javax.persistence.PersistenceContext;
import java.util.List;
import java.util.Optional;
import java.util.Set;

@Repository
public interface GameRepository extends CrudRepository<Game, Long> {

    List<Game> findByTournament(Tournament tournament, Pageable pageable);

    Integer countByTournament(Tournament tournament);
    List<Game> findByTournamentName(@Param("tournamentName")String tournamentName, Pageable pageable);
    List<Game> findByTournamentNameOrderByDateDesc(@Param("tournamentName")String tournamentName, Pageable pageable);

   /* @Query("SELECT g FROM Game g " +
            "INNER JOIN g.outcomes o " +
            "WHERE o.user.userId = :userId AND g.tournament.tournamentId = :tournamentId")*/
    public List<Game> findByOutcomesUserUserIdAndTournamentTournamentId(@Param("userId") Long userId, @Param("tournamentId") Long tournamentId, Pageable pageable);

   /* @Query("SELECT g FROM Game g " +
                    "INNER JOIN g.outcomes o " +
                    "WHERE o.user.userName = :userName AND g.tournament.name= :tournamentName")*/
    public List<Game> findByOutcomesUserUserNameAndTournamentNameOrderByDateDesc(@Param("userName") String username, @Param("tournamentName") String tournamentName, Pageable pageable);

  /*  @Query("SELECT g FROM Game g " +
            "INNER JOIN g.outcomes o " +
            "WHERE o.user.userId = :userId")*/
    List<Game> findByOutcomesUserUserId(@Param("userId") Long userId, Pageable pageable);

   /* @Query("SELECT g FROM Game g " +
                    "INNER JOIN g.outcomes o " +
                    "WHERE o.user.userName = :userName")*/
    List<Game> findByOutcomesUserUserName(@Param("userName") String username, Pageable pageable);

    List<Game> findByOutcomesUserUserNameOrderByDateDesc(@Param("userName") String username, Pageable pageable);

    /*@Query("SELECT g FROM Game g " +
            "INNER JOIN g.outcomes o " +
            "WHERE o.user = :user")*/
    List<Game> findByOutcomesUserOrderByDateDesc(@Param("user")User user, Pageable pageable);
}