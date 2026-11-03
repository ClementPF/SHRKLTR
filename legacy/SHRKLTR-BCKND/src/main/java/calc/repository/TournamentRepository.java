package calc.repository;

import calc.entity.Sport;
import calc.entity.Tournament;
import org.springframework.data.repository.CrudRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Set;

@Repository
public interface TournamentRepository extends CrudRepository<Tournament, Long> {
    List<Tournament> findBySport(Sport sport);
    List<Tournament> findBySportId(Long sportId);
    Tournament findByName(String name);
    List<Tournament> findAll();
    List<Tournament> findByUserName(String username);
}