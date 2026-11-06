package calc.repository;

import calc.entity.Game;
import calc.entity.Sport;
import calc.entity.Tournament;
import org.springframework.data.repository.CrudRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import javax.persistence.EntityManager;
import javax.persistence.PersistenceContext;
import java.util.List;

@Repository
public interface SportRepository extends CrudRepository<Sport, Long> {
    Sport findBySportId(Long id);
    Sport findByName(String name);
}