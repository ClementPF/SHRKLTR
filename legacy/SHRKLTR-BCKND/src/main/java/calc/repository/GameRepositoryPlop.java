package calc.repository;

import calc.entity.Game;
import calc.entity.Tournament;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.repository.query.Param;

import javax.persistence.*;
import java.util.List;

/**
 * Created by clementperez on 09/11/18.
 */
public class GameRepositoryPlop {

    @Autowired
    private EntityManager em;

    /*
    @Entity
    @NamedQueries({
            @NamedQuery(name = "Game.findByTournamentName", query = "SELECT m FROM Game m WHERE m.tournament.name = ?1"),
            @NamedQuery(name = "Game.findByOutcomeUserUserId",
                    query = "SELECT m FROM Game m " +
                            "INNER JOIN m.outcomes o " +
                            "WHERE o.user.userId = ?1"),
            @NamedQuery(name = "Game.findByOutcomesUserUserName",
                    query = "SELECT m FROM Game m " +
                            "INNER JOIN m.outcomes o " +
                            "WHERE o.user.userName = ?1"),
            @NamedQuery(name = "Game.findByOutcomeUserUserIdByTournamentTournamentName",
                    query = "SELECT m FROM Game m " +
                            "INNER JOIN m.outcomes o " +
                            "WHERE o.user.userId = ?1 AND m.tournament.name=?2" ),
            @NamedQuery(name = "Game.findByOutcomeUserUserNameAndByTournamentName",
                    query = "SELECT m FROM Game m " +
                            "INNER JOIN m.outcomes o " +
                            "WHERE o.user.userName = ?1 AND m.tournament.name=?2" )
    })*/

    //@Override
    public List<Game> findByTournament(Tournament tournament, int offset, int limit) {

        String query = "SELECT * FROM Game WHERE tournament_id = :tournamentId";
        Query nativeQuery = em.createNativeQuery(query);
        nativeQuery.setParameter("tournamentId", tournament.getTournamentId());

        //Paginering
        nativeQuery.setFirstResult(offset);
        nativeQuery.setMaxResults(limit);

        return nativeQuery.getResultList();
    }

    //@Override
    public List<Game> findByUserIdByTournamentName(@Param("userId") Long userId, @Param("tournamentName") String tournamentId) {
        return null;
    }

    //@Override
    public List<Game> findByUserNameByTournamentName(@Param("userName") String username, @Param("tournamentName") String tournamentId) {
        return null;
    }

    //@Override
    public List<Game> findByTournamentName(String tournamentName, int offset, int limit) {
        return null;
    }
    //@Override
    public List<Game> findByTournamentName2(String tournamentName) {
        return null;
    }

    //@Override
    public List<Game> findByUserId(Long userId) {
        return null;
    }

    //@Override
    public List<Game> findByUserName(String username) {
        return null;
    }

        //@Override
        public <S extends Game> S save(S s) {
            return null;
        }

        //@Override
        public <S extends Game> Iterable<S> save(Iterable<S> ses) {
            return null;
        }

        //@Override
        public Game findOne(Long aLong) {
            return null;
        }


    //@Override
    public boolean exists(Long aLong) {
        return false;
    }

    //@Override
    public Iterable<Game> findAll() {
        return null;
    }

    //@Override
    public Iterable<Game> findAll(Iterable<Long> longs) {
        return null;
    }

    //@Override
    public long count() {
        return 0;
    }

    //@Override
    public void delete(Long aLong) {

    }

    //@Override
    public void delete(Game game) {

    }

    //@Override
    public void delete(Iterable<? extends Game> games) {

    }

    //@Override
    public void deleteAll() {

    }
}
