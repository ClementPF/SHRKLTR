package calc.repository;

import calc.entity.Outcome;
import calc.entity.User;
import org.springframework.data.repository.CrudRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Set;

/**
 * Created by clementperez on 9/23/16.
 */
@Repository
public interface OutcomeRepository extends CrudRepository<Outcome, Long> {
    List<Outcome> findByUser(User user);
    List<Outcome> findByUserId(Long userId);
    List<Outcome> findByGameId(Long gameId);
}
